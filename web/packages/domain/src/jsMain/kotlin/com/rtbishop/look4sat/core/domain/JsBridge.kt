/*
 * Look4Sat Web — JS bridge for SGP4/SDP4 orbital propagation.
 * Exports thin wrappers around core:domain predict functions.
 */
package com.rtbishop.look4sat.core.domain

import com.rtbishop.look4sat.core.domain.predict.CelestialComputer
import com.rtbishop.look4sat.core.domain.predict.DEG2RAD
import com.rtbishop.look4sat.core.domain.predict.GeoPos
import com.rtbishop.look4sat.core.domain.predict.OrbitalData
import com.rtbishop.look4sat.core.domain.predict.OrbitalObject
import com.rtbishop.look4sat.core.domain.predict.RAD2DEG
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

// ── JSON-serializable result types (decoupled from mutable domain classes) ──

@Serializable
data class WasmOrbitalPos(
    val azimuth: Double,
    val elevation: Double,
    val latitude: Double,
    val longitude: Double,
    val altitude: Double,
    val distance: Double,
    val distanceRate: Double,
    val theta: Double,
    val time: Long,
    val phase: Double,
    val eclipseDepth: Double,
    val eclipsed: Boolean,
    val aboveHorizon: Boolean,
    val orbitalVelocity: Double,
    val downlinkFreq: Long,
    val uplinkFreq: Long,
)

@Serializable
data class WasmSunPosition(
    val azimuth: Double,
    val elevation: Double,
    val latitude: Double,
    val longitude: Double,
)

@Serializable
data class WasmMoonPosition(
    val azimuth: Double,
    val elevation: Double,
    val latitude: Double,
    val longitude: Double,
)

@Serializable
data class WasmPass(
    val aosTime: Double,
    val aosAzimuth: Double,
    val losTime: Double,
    val losAzimuth: Double,
    val altitude: Int,
    val maxElevation: Double,
    val catNum: Int,
    val name: String,
    val isDeepSpace: Boolean,
    val hasDecayed: Boolean,
)

@Serializable
data class WasmPassList(val passes: List<WasmPass>)

// ── Shared JSON instance ──

private val bridgeJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    allowSpecialFloatingPointValues = true // SGP4 may produce NaN/Infinity
}

private fun Double.sanitize(): Double = when {
    this.isNaN() -> 0.0
    this.isInfinite() -> if (this > 0) 1e300 else -1e300
    else -> this
}

// ── Cached OrbitalObject to avoid re-parsing on every tick ──

private var cachedObject: OrbitalObject? = null
private var cachedCatnum: Int = -1

private fun getOrCreateObject(jsonOrbitalData: String): OrbitalObject? {
    return try {
        val data = bridgeJson.decodeFromString<OrbitalData>(jsonOrbitalData)
        if (data.catnum != cachedCatnum) {
            cachedObject = data.getObject()
            cachedCatnum = data.catnum
        }
        cachedObject
    } catch (e: Exception) {
        println("WasmBridge: failed to parse OrbitalData: ${e.message}")
        null
    }
}

// ── Exported functions ──

/**
 * Calculate satellite position for a given observer and time.
 * @param jsonOrbitalData JSON-serialized [OrbitalData]
 * @param lat Observer latitude (degrees)
 * @param lon Observer longitude (degrees)
 * @param alt Observer altitude (meters)
 * @param timeMs Unix epoch milliseconds
 * @return JSON-serialized [WasmOrbitalPos]
 */
@JsExport
fun look4satGetPosition(
    jsonOrbitalData: String,
    lat: Double,
    lon: Double,
    alt: Double,
    timeMs: Double,  // Double to avoid Kotlin/JS Long conversion issues
): String {
    val obj = getOrCreateObject(jsonOrbitalData) ?: return "null"
    val pos = GeoPos(lat, lon, alt)
    val orbitalPos = obj.getPosition(pos, timeMs.toLong())
    val result = WasmOrbitalPos(
        azimuth = (orbitalPos.azimuth * RAD2DEG).sanitize(),
        elevation = (orbitalPos.elevation * RAD2DEG).sanitize(),
        latitude = (orbitalPos.latitude * RAD2DEG).sanitize(),
        longitude = (orbitalPos.longitude * RAD2DEG).sanitize(),
        altitude = orbitalPos.altitude.sanitize(),
        distance = orbitalPos.distance.sanitize(),
        distanceRate = orbitalPos.distanceRate.sanitize(),
        theta = orbitalPos.theta.sanitize(),
        time = orbitalPos.time,
        phase = orbitalPos.phase.sanitize(),
        eclipseDepth = orbitalPos.eclipseDepth.sanitize(),
        eclipsed = orbitalPos.eclipsed,
        aboveHorizon = orbitalPos.aboveHorizon,
        orbitalVelocity = orbitalPos.getOrbitalVelocity().sanitize(),
        downlinkFreq = 0L,
        uplinkFreq = 0L,
    )
    return bridgeJson.encodeToString(result)
}

/** Check if satellite is visible from observer. */
@JsExport
fun look4satWillBeSeen(jsonOrbitalData: String, lat: Double, lon: Double): Boolean {
    val obj = getOrCreateObject(jsonOrbitalData) ?: return false
    return obj.willBeSeen(GeoPos(lat, lon, 0.0))
}

/** Get Sun position for observer at time. */
@JsExport
fun look4satGetSunPosition(lat: Double, lon: Double, timeMs: Double): String {
    val pos = CelestialComputer.getSunPosition(GeoPos(lat, lon, 0.0), timeMs.toLong())
    return bridgeJson.encodeToString(WasmSunPosition(
        azimuth = pos.azimuth.sanitize(),
        elevation = pos.elevation.sanitize(),
        latitude = pos.latitude.sanitize(),
        longitude = pos.longitude.sanitize(),
    ))
}

/** Get Moon position for observer at time. */
@JsExport
fun look4satGetMoonPosition(lat: Double, lon: Double, timeMs: Double): String {
    val pos = CelestialComputer.getMoonPosition(GeoPos(lat, lon, 0.0), timeMs.toLong())
    // Moon returns GHA (Greenwich Hour Angle) and declination.
    // Convert GHA (degrees west from Greenwich, 0..360) to longitude (-180..+180 east).
    val moonLon = if (pos.gha > 180.0) 360.0 - pos.gha else -pos.gha
    return bridgeJson.encodeToString(WasmMoonPosition(
        azimuth = pos.azimuth.sanitize(),
        elevation = pos.elevation.sanitize(),
        latitude = pos.declination.sanitize(),
        longitude = moonLon.sanitize(),
    ))
}

/**
 * Calculate all passes for a satellite over a time window.
 * Uses the same pass-finding algorithm as the Android app.
 */
@JsExport
fun look4satCalculatePasses(
    jsonOrbitalData: String,
    lat: Double,
    lon: Double,
    alt: Double,
    startTimeMs: Double,
    endTimeMs: Double,
    minElevation: Double,
): String {
    val obj = getOrCreateObject(jsonOrbitalData) ?: return """{"passes":[]}"""
    val pos = GeoPos(lat, lon, alt)

    // Convert minElevation from degrees (passed by TS) to radians (used internally)
    val minElevRad = minElevation * DEG2RAD

    // Brute-force pass search: sample every 15 seconds, look for horizon crossings
    val stepMs = 15000L
    val passes = mutableListOf<WasmPass>()
    var inPass = false
    var aosTime = 0.0
    var aosAz = 0.0
    var maxElev = 0.0

    var t = startTimeMs
    while (t <= endTimeMs) {
        val elev = obj.getElevation(pos, t.toLong()).sanitize()

        if (!inPass && elev > minElevRad) {
            // AOS — get full position for azimuth
            inPass = true
            aosTime = t
            val fp = obj.getFullPosition(pos, t.toLong())
            aosAz = fp.azimuth
            maxElev = elev
        } else if (inPass) {
            if (elev > maxElev) maxElev = elev
            if (elev < minElevRad) {
                // LOS — get full position for azimuth
                val fp = obj.getFullPosition(pos, t.toLong())
                passes.add(
                    WasmPass(
                        aosTime = aosTime,
                        aosAzimuth = (aosAz * RAD2DEG).sanitize(),
                        losTime = t,
                        losAzimuth = (fp.azimuth * RAD2DEG).sanitize(),
                        altitude = fp.altitude.toInt(),
                        maxElevation = (maxElev * RAD2DEG).sanitize(),
                        catNum = obj.data.catnum,
                        name = obj.data.name,
                        isDeepSpace = obj.data.isDeepSpace,
                        hasDecayed = obj.data.hasDecayed(t.toLong()),
                    )
                )
                inPass = false
                maxElev = 0.0
            }
        }
        t += stepMs
    }

    return bridgeJson.encodeToString(WasmPassList(passes))
}
