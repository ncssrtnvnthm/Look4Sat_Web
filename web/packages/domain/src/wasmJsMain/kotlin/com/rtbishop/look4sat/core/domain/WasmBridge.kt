/*
 * Look4Sat Web — Wasm/JS bridge for SGP4/SDP4 orbital propagation.
 * Exports thin wrappers around core:domain predict functions.
 */
@file:OptIn(kotlin.js.ExperimentalJsExport::class)

package com.rtbishop.look4sat.core.domain

import com.rtbishop.look4sat.core.domain.predict.CelestialComputer
import com.rtbishop.look4sat.core.domain.predict.GeoPos
import com.rtbishop.look4sat.core.domain.predict.OrbitalData
import com.rtbishop.look4sat.core.domain.predict.OrbitalObject
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
)

@Serializable
data class WasmMoonPosition(
    val azimuth: Double,
    val elevation: Double,
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

// ── Shared JSON instance ──

private val bridgeJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
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
    timeMs: Long,
): String {
    val obj = getOrCreateObject(jsonOrbitalData) ?: return "null"
    val pos = GeoPos(lat, lon, alt)
    val orbitalPos = obj.getPosition(pos, timeMs)
    val result = WasmOrbitalPos(
        azimuth = orbitalPos.azimuth,
        elevation = orbitalPos.elevation,
        latitude = orbitalPos.latitude,
        longitude = orbitalPos.longitude,
        altitude = orbitalPos.altitude,
        distance = orbitalPos.distance,
        distanceRate = orbitalPos.distanceRate,
        theta = orbitalPos.theta,
        time = orbitalPos.time,
        phase = orbitalPos.phase,
        eclipseDepth = orbitalPos.eclipseDepth,
        eclipsed = orbitalPos.eclipsed,
        aboveHorizon = orbitalPos.aboveHorizon,
        orbitalVelocity = orbitalPos.getOrbitalVelocity(),
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
fun look4satGetSunPosition(lat: Double, lon: Double, timeMs: Long): String {
    val pos = CelestialComputer.getSunPosition(GeoPos(lat, lon, 0.0), timeMs)
    return bridgeJson.encodeToString(WasmSunPosition(pos.azimuth, pos.elevation))
}

/** Get Moon position for observer at time. */
@JsExport
fun look4satGetMoonPosition(lat: Double, lon: Double, timeMs: Long): String {
    val pos = CelestialComputer.getMoonPosition(GeoPos(lat, lon, 0.0), timeMs)
    return bridgeJson.encodeToString(WasmMoonPosition(pos.azimuth, pos.elevation))
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

    // Brute-force pass search: sample every 15 seconds, look for horizon crossings
    val stepMs = 15000L
    val passes = mutableListOf<WasmPass>()
    var inPass = false
    var aosTime = 0L
    var aosAz = 0.0
    var maxElev = 0.0

    var t = startTimeMs
    while (t <= endTimeMs) {
        val elev = obj.getElevation(pos, t)

        if (!inPass && elev > minElevation) {
            // AOS — get full position for azimuth
            inPass = true
            aosTime = t
            val fp = obj.getFullPosition(pos, t)
            aosAz = fp.azimuth
            maxElev = elev
        } else if (inPass) {
            if (elev > maxElev) maxElev = elev
            if (elev < minElevation) {
                // LOS — get full position for azimuth
                val fp = obj.getFullPosition(pos, t)
                passes.add(
                    WasmPass(
                        aosTime = aosTime,
                        aosAzimuth = aosAz,
                        losTime = t,
                        losAzimuth = fp.azimuth,
                        altitude = fp.altitude.toInt(),
                        maxElevation = maxElev,
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
