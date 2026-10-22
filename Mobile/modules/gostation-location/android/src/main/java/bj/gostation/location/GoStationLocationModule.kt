package bj.gostation.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.location.LocationRequestCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * Position par le LocationManager d'Android (fournisseurs GPS et réseau), pour les téléphones
 * sans Google Play Services où le fused provider d'expo-location échoue (SERVICE_INVALID).
 * Aucune dépendance aux services Huawei. Les positions ne sont ni journalisées ni conservées ici :
 * elles partent vers le JS, qui les garde en mémoire seulement (règle 2).
 */
@SuppressLint("MissingPermission") // permissions vérifiées avant chaque appel (hasFine, hasAnyPermission)
class GoStationLocationModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val manager: LocationManager
    get() = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  private val main = Handler(Looper.getMainLooper())
  private val requests = mutableSetOf<SingleRequest>()
  private val watchers = mutableMapOf<Int, Watcher>()

  override fun definition() = ModuleDefinition {
    Name("GoStationLocation")
    Events(EVENT)

    // Vrai si les services Google sont présents et utilisables (sinon le fused provider échoue).
    Function("hasGooglePlayServices") {
      runCatching {
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
      }.getOrDefault(false)
    }

    Function("getProviderStatus") {
      mapOf(
        "locationEnabled" to LocationManagerCompat.isLocationEnabled(manager),
        "gps" to isEnabled(LocationManager.GPS_PROVIDER),
        "network" to isEnabled(LocationManager.NETWORK_PROVIDER),
      )
    }

    // Meilleure dernière position connue de moins de maxAgeMs (la plus récente, ou une plus précise
    // reçue dans la minute qui la précède), ou null.
    AsyncFunction("getLastKnownPosition") { maxAgeMs: Double ->
      if (!hasAnyPermission()) throw LocationUnauthorizedException()
      lastKnown(maxAgeMs)?.toMap()
    }

    // Une mesure : GPS et réseau écoutés ensemble ; résolue dès une position assez précise, sinon
    // settleMs après la première (la meilleure reçue), au plus tard à timeoutMs.
    AsyncFunction("getCurrentPosition") { options: CurrentOptions, promise: Promise ->
      main.post {
        if (!hasAnyPermission()) return@post promise.reject(LocationUnauthorizedException())
        val providers = activeProviders()
        if (providers.isEmpty()) return@post promise.reject(LocationServicesDisabledException())
        SingleRequest(providers, options, promise).start()
      }
    }

    // Suivi (guidage) : positions envoyées par l'événement onLocation, avec l'identifiant du suivi.
    Function("startWatching") { id: Int, options: WatchOptions ->
      main.post {
        watchers.remove(id)?.stop()
        if (!hasAnyPermission()) return@post
        val w = Watcher(id, activeProviders(), options)
        watchers[id] = w
        w.start()
      }
      Unit
    }

    Function("stopWatching") { id: Int ->
      main.post { watchers.remove(id)?.stop() }
      Unit
    }

    OnDestroy {
      main.post {
        watchers.values.forEach { it.stop() }
        watchers.clear()
        requests.toList().forEach { it.cancel() }
      }
    }
  }

  private fun lastKnown(maxAgeMs: Double): Location? {
    val known = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
      .mapNotNull { p -> runCatching { manager.getLastKnownLocation(p) }.getOrNull() }
      .filter { it.ageMs() <= maxAgeMs }
    val newest = known.minByOrNull { it.ageMs() } ?: return null
    return known.filter { it.ageMs() - newest.ageMs() <= 60_000 }.minByOrNull { it.accuracyOrMax() }
  }

  private fun granted(permission: String) =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

  private fun hasFine() = granted(Manifest.permission.ACCESS_FINE_LOCATION)

  private fun hasAnyPermission() = hasFine() || granted(Manifest.permission.ACCESS_COARSE_LOCATION)

  private fun isEnabled(provider: String) =
    runCatching { manager.allProviders.contains(provider) && manager.isProviderEnabled(provider) }.getOrDefault(false)

  // Le GPS exige la position précise ; le réseau suffit en position approximative.
  private fun activeProviders(): List<String> = buildList {
    if (hasFine() && isEnabled(LocationManager.GPS_PROVIDER)) add(LocationManager.GPS_PROVIDER)
    if (isEnabled(LocationManager.NETWORK_PROVIDER)) add(LocationManager.NETWORK_PROVIDER)
  }

  private fun request(provider: String, intervalMs: Long, distanceM: Float, listener: LocationListenerCompat): Boolean {
    val quality =
      if (provider == LocationManager.GPS_PROVIDER) LocationRequestCompat.QUALITY_HIGH_ACCURACY
      else LocationRequestCompat.QUALITY_BALANCED_POWER_ACCURACY
    val req = LocationRequestCompat.Builder(intervalMs).setMinUpdateDistanceMeters(distanceM).setQuality(quality).build()
    return try {
      LocationManagerCompat.requestLocationUpdates(manager, provider, req, listener, Looper.getMainLooper())
      true
    } catch (e: SecurityException) {
      false
    } catch (e: IllegalArgumentException) {
      false
    }
  }

  private fun release(listener: LocationListenerCompat) {
    runCatching { LocationManagerCompat.removeUpdates(manager, listener) }
  }

  private inner class SingleRequest(
    private val providers: List<String>,
    private val options: CurrentOptions,
    private val promise: Promise,
  ) : LocationListenerCompat {
    private var best: Location? = null
    private var done = false
    private var deadline = 0L
    private val finish = Runnable { finish() }

    fun start() {
      requests += this
      val started = providers.count { request(it, 1_000L, 0f, this) }
      if (started == 0) {
        done = true
        requests -= this
        return promise.reject(LocationServicesDisabledException())
      }
      deadline = SystemClock.uptimeMillis() + options.timeoutMs.toLong()
      main.postAtTime(finish, deadline)
    }

    override fun onLocationChanged(location: Location) {
      if (done) return
      val first = best == null
      if (first || location.accuracyOrMax() < best!!.accuracyOrMax()) best = location
      if (location.accuracyOrMax() <= options.goodAccuracyM) {
        finish()
      } else if (first) {
        // Attente d'une meilleure position, sans dépasser le délai global.
        main.removeCallbacks(finish)
        main.postAtTime(finish, minOf(SystemClock.uptimeMillis() + options.settleMs.toLong(), deadline))
      }
    }

    private fun finish() {
      if (done) return
      stop()
      val fix = best
      if (fix != null) promise.resolve(fix.toMap()) else promise.reject(LocationTimeoutException())
    }

    fun cancel() {
      if (done) return
      stop()
      promise.reject(LocationTimeoutException())
    }

    private fun stop() {
      done = true
      main.removeCallbacks(finish)
      release(this)
      requests -= this
    }
  }

  private inner class Watcher(
    private val id: Int,
    private val providers: List<String>,
    private val options: WatchOptions,
  ) : LocationListenerCompat {
    private var lastGpsAt = 0L

    fun start() {
      providers.forEach { request(it, options.intervalMs.toLong(), options.distanceM.toFloat(), this) }
    }

    override fun onLocationChanged(location: Location) {
      val now = SystemClock.elapsedRealtime()
      if (location.provider == LocationManager.GPS_PROVIDER) {
        lastGpsAt = now
      } else if (lastGpsAt > 0 && now - lastGpsAt < GPS_PRIORITY_MS) {
        // GPS actif : la position réseau, moins précise, ferait sauter le guidage.
        return
      }
      sendEvent(EVENT, mapOf("watchId" to id, "location" to location.toMap()))
    }

    fun stop() = release(this)
  }

  companion object {
    private const val EVENT = "onLocation"
    private const val GPS_PRIORITY_MS = 10_000L
  }
}

class CurrentOptions : Record {
  @Field val timeoutMs: Double = 15_000.0

  @Field val goodAccuracyM: Double = 50.0

  @Field val settleMs: Double = 3_000.0
}

class WatchOptions : Record {
  @Field val intervalMs: Double = 1_000.0

  @Field val distanceM: Double = 0.0
}

class LocationUnauthorizedException : CodedException("ERR_LOCATION_UNAUTHORIZED", "Location permission not granted", null)

class LocationServicesDisabledException : CodedException("ERR_LOCATION_SERVICES_DISABLED", "No enabled location provider", null)

class LocationTimeoutException : CodedException("ERR_LOCATION_TIMEOUT", "No location before the timeout", null)

private fun Location.ageMs(): Long = (SystemClock.elapsedRealtimeNanos() - elapsedRealtimeNanos) / 1_000_000

private fun Location.accuracyOrMax(): Float = if (hasAccuracy()) accuracy else Float.MAX_VALUE

private fun Location.toMap(): Map<String, Any?> = mapOf(
  "latitude" to latitude,
  "longitude" to longitude,
  "accuracy" to if (hasAccuracy()) accuracy.toDouble() else null,
  "altitude" to if (hasAltitude()) altitude else null,
  "speed" to if (hasSpeed()) speed.toDouble() else null,
  "heading" to if (hasBearing()) bearing.toDouble() else null,
  "timestamp" to time.toDouble(),
  "provider" to provider,
)
