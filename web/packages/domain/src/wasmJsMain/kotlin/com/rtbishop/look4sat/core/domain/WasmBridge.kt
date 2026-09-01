/*
 * Look4Sat Web — Wasm/JS bridge for SGP4/SDP4 orbital propagation.
 * Exports thin wrappers around core:domain predict functions.
 * NOTE: kept in sync with JsBridge.kt (jsMain); units are converted to degrees here.
 */
@file:OptIn(kotlin.js.ExperimentalJsExport::class)

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
    val aosTime: Long,
    val aosAzimuth: Double,
    val losTime: Long,
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

@Serializable
data class WasmTrackPoint(
    val latitude: Double,
    val longitude: Double,
)

@Serializable
data class WasmTrackList(val points: List<WasmTrackPoint>)

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
// Keyed by the exact serialized payload (not just catnum), so a Celestrak
// refresh that rewrites a satellite's elements is picked up immediately (M6).

private var cachedObject: OrbitalObject? = null
private var cachedJson: String? = null

private fun getOrCreateObject(jsonOrbitalData: String): OrbitalObject? {
    return try {
        if (jsonOrbitalData != cachedJson) {
            val data = bridgeJson.decodeFromString<OrbitalData>(jsonOrbitalData)
            cachedObject = data.getObject()
            cachedJson = jsonOrbitalData
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
    timeMs: Long,
): String {
    val obj = getOrCreateObject(jsonOrbitalData) ?: return "null"
    val pos = GeoPos(lat, lon, alt)
    val orbitalPos = obj.getPosition(pos, timeMs)
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

/** Get Sun position for observer at time. */
@JsExport
fun look4satGetSunPosition(lat: Double, lon: Double, timeMs: Long): String {
    val pos = CelestialComputer.getSunPosition(GeoPos(lat, lon, 0.0), timeMs)
    return bridgeJson.encodeToString(
        WasmSunPosition(
            azimuth = pos.azimuth.sanitize(),
            elevation = pos.elevation.sanitize(),
            latitude = pos.latitude.sanitize(),
            longitude = pos.longitude.sanitize(),
        )
    )
}

/** Get Moon position for observer at time. */
@JsExport
fun look4satGetMoonPosition(lat: Double, lon: Double, timeMs: Long): String {
    val pos = CelestialComputer.getMoonPosition(GeoPos(lat, lon, 0.0), timeMs)
    // Moon returns GHA (Greenwich Hour Angle) and declination.
    // Convert GHA (degrees west from Greenwich, 0..360) to longitude (-180..+180 east).
    val moonLon = if (pos.gha > 180.0) 360.0 - pos.gha else -pos.gha
    return bridgeJson.encodeToString(
        WasmMoonPosition(
            azimuth = pos.azimuth.sanitize(),
            elevation = pos.elevation.sanitize(),
            latitude = pos.declination.sanitize(),
            longitude = moonLon.sanitize(),
        )
    )
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
    startTimeMs: Long,
    endTimeMs: Long,
    minElevation: Double,
): String {
    val obj = getOrCreateObject(jsonOrbitalData) ?: return """{"passes":[]}"""
    val pos = GeoPos(lat, lon, alt)

    // Skip satellites that can never rise above the observer's horizon
    // (matches the Android app's willBeSeen() optimization).
    if (!obj.willBeSeen(pos)) return """{"passes":[]}"""

    // Convert minElevation from degrees (passed by TS) to radians (used internally)
    val minElevRad = minElevation * DEG2RAD

    // Brute-force pass search: sample every 15 seconds, look for horizon crossings
    val stepMs = 15000L
    val passes = mutableListOf<WasmPass>()
    var inPass = false
    var aosTime = 0L
    var aosAz = 0.0
    var maxElev = 0.0

    var t = startTimeMs
    while (t <= endTimeMs) {
        val elev = obj.getElevation(pos, t).sanitize()

        if (!inPass && elev > minElevRad) {
            // AOS — get full position for azimuth
            inPass = true
            aosTime = t
            val fp = obj.getFullPosition(pos, t)
            aosAz = fp.azimuth
            maxElev = elev
        } else if (inPass) {
            if (elev > maxElev) maxElev = elev
            if (elev < minElevRad) {
                // LOS — get full position for azimuth
                val fp = obj.getFullPosition(pos, t)
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
                        hasDecayed = obj.data.hasDecayed(t),
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

/**
 * Compute a ground-track sample list for a satellite over a time window.
 * Batched into a single call so the frontend doesn't do thousands of
 * JSON round-trips per track.
 */
@JsExport
fun look4satGetTrack(
    jsonOrbitalData: String,
    lat: Double,
    lon: Double,
    alt: Double,
    startTimeMs: Long,
    endTimeMs: Long,
    stepMs: Long,
): String {
    val obj = getOrCreateObject(jsonOrbitalData) ?: return """{"points":[]}"""
    val pos = GeoPos(lat, lon, alt)

    val step = if (stepMs > 0L) stepMs else 15000L
    val points = mutableListOf<WasmTrackPoint>()
    var t = startTimeMs
    // Hard cap to protect the UI thread from pathological windows (e.g. GEO).
    val maxSamples = 10000
    while (t < endTimeMs && points.size < maxSamples) {
        val fp = obj.getFullPosition(pos, t)
        points.add(
            WasmTrackPoint(
                latitude = (fp.latitude * RAD2DEG).sanitize(),
                longitude = (fp.longitude * RAD2DEG).sanitize(),
            )
        )
        t += step
    }

    return bridgeJson.encodeToString(WasmTrackList(points))
}
