package expo.modules.ipv6voice

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VoiceEngineModule : Module() {
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val enrollment = lazy { EnrollmentHandshake(context.applicationContext) }
  private val controller: VoiceEngineController
    get() = VoiceRuntime.controller ?: synchronized(VoiceRuntime) {
      VoiceRuntime.controller ?: VoiceEngineController(context.applicationContext).also { VoiceRuntime.controller = it }
    }

  override fun definition() = ModuleDefinition {
    Name("IPv6VoiceEngine")
    Events("onCallState", "onHandshakeFrame", "onVerification", "onQuality", "onError")

    OnCreate {
      VoiceRuntime.emit = { name, payload -> sendEvent(name, payload) }
    }

    OnDestroy {
      VoiceRuntime.emit = null
      if (enrollment.isInitialized()) enrollment.value.cancel()
    }

    AsyncFunction("beginEnrollmentProof") { options: Map<String, Any?> ->
      enrollment.value.begin(
        options["challengeId"] as String,
        options["principalId"] as String,
        options["nonce"] as String,
        options["serverKey"] as String,
        options["keyId"] as String,
        options["origin"] as String,
        (options["ttlSeconds"] as Number).toInt(),
        options["legacyScope"] as? String,
        options["rotation"] as? Map<*, *>,
      )
    }
    AsyncFunction("finishEnrollmentProof") { challengeId: String, handshake: String ->
      enrollment.value.finish(challengeId, handshake)
    }
    AsyncFunction("cancelEnrollmentProof") { challengeId: String ->
      if (enrollment.isInitialized()) enrollment.value.cancel(challengeId)
    }

    AsyncFunction("getOrCreateIdentity") { accountScope: String ->
      mapOf("publicKey" to controller.getOrCreateIdentity(accountScope))
    }
    AsyncFunction("identityFingerprint") { scope: String -> controller.identityFingerprint(scope) }
    AsyncFunction("removeProfile") { scope: String, username: String -> controller.removeProfile(scope, username) }
    AsyncFunction("hasIdentity") { accountScope: String -> controller.hasIdentity(accountScope) }

    AsyncFunction("prepareCall") { options: Map<String, Any?> -> controller.prepare(options) }
    AsyncFunction("consumeHandshakeFrame") { frame: String -> controller.consumeHandshake(frame) }
    AsyncFunction("registerDirectEndpoint") { ticket: Map<String, Any?> -> controller.registerDirect(ticket) }
    AsyncFunction("setDirectEndpoint") { endpoint: String -> controller.setDirectEndpoint(endpoint) }
    AsyncFunction("confirmPeerVerification") { controller.confirmPeer() }
    AsyncFunction("setMuted") { muted: Boolean -> controller.setMuted(muted) }
    AsyncFunction("setOutputRoute") { route: String -> controller.setOutputRoute(route) }
    AsyncFunction("endCall") { reason: String? -> controller.end(reason ?: "normal") }
    AsyncFunction("getDiagnostics") { controller.diagnostics() }
  }
}
