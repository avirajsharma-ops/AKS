package cloud.itsmira.aks.services

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.*

/**
 * Native Android Speech Recognition Service
 * Provides continuous 24/7 speech recognition independent of WebView
 * Used as backup when app is in background
 */
class NativeSpeechRecognizer(
    private val context: Context,
    private val onTranscript: (String, Boolean) -> Unit, // text, isFinal
    private val onError: (String) -> Unit
) {
    companion object {
        private const val TAG = "NativeSpeechRecognizer"
        private const val RESTART_DELAY_MS = 100L
        private const val MAX_SILENCE_MS = 3000L
    }

    private var speechRecognizer: SpeechRecognizer? = null
    private var isListening = false
    private var shouldBeListening = false
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var restartJob: Job? = null

    private val _isActive = MutableStateFlow(false)
    val isActive: StateFlow<Boolean> = _isActive

    fun start() {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            Log.e(TAG, "Speech recognition not available on this device")
            onError("Speech recognition not available")
            return
        }

        shouldBeListening = true
        startListening()
    }

    fun stop() {
        shouldBeListening = false
        stopListening()
        restartJob?.cancel()
    }

    fun pause() {
        Log.d(TAG, "Pausing speech recognition")
        stopListening()
    }

    fun resume() {
        Log.d(TAG, "Resuming speech recognition")
        if (shouldBeListening) {
            startListening()
        }
    }

    private fun startListening() {
        if (isListening) return

        try {
            // Create new recognizer instance each time for reliability
            speechRecognizer?.destroy()
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                setRecognitionListener(createRecognitionListener())
            }

            val intent = createRecognizerIntent()
            speechRecognizer?.startListening(intent)
            isListening = true
            _isActive.value = true
            Log.d(TAG, "🎙️ Native speech recognition started")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to start speech recognition", e)
            isListening = false
            _isActive.value = false
            scheduleRestart()
        }
    }

    private fun stopListening() {
        try {
            speechRecognizer?.stopListening()
            speechRecognizer?.cancel()
            speechRecognizer?.destroy()
            speechRecognizer = null
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping speech recognizer", e)
        }
        isListening = false
        _isActive.value = false
    }

    private fun createRecognizerIntent(): Intent {
        return Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            // Support Hindi and English
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "en-IN")
            putExtra(RecognizerIntent.EXTRA_SUPPORTED_LANGUAGES, arrayOf("en-IN", "hi-IN", "en-US"))
            // Continuous listening settings
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            // Don't require network - use offline recognition if available
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false)
            // Speech detection settings
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 500L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, MAX_SILENCE_MS)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, MAX_SILENCE_MS)
        }
    }

    private fun createRecognitionListener(): RecognitionListener {
        return object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                Log.d(TAG, "Ready for speech")
            }

            override fun onBeginningOfSpeech() {
                Log.d(TAG, "Beginning of speech detected")
            }

            override fun onRmsChanged(rmsdB: Float) {
                // Audio level changed - can be used for visual feedback
            }

            override fun onBufferReceived(buffer: ByteArray?) {
                // Audio buffer received
            }

            override fun onEndOfSpeech() {
                Log.d(TAG, "End of speech")
                isListening = false
            }

            override fun onError(error: Int) {
                val errorMessage = getErrorMessage(error)
                Log.e(TAG, "Speech recognition error: $errorMessage ($error)")
                isListening = false
                _isActive.value = false

                when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH,
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> {
                        // Normal - no speech detected, restart immediately
                        Log.d(TAG, "🔄 No speech, restarting...")
                        scheduleRestart(50)
                    }
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> {
                        // Recognizer busy, wait a bit
                        scheduleRestart(500)
                    }
                    SpeechRecognizer.ERROR_NETWORK,
                    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> {
                        // Network issue, retry after delay
                        Log.d(TAG, "🔄 Network error, retrying...")
                        scheduleRestart(1000)
                    }
                    SpeechRecognizer.ERROR_AUDIO -> {
                        // Audio recording error
                        onError("Microphone error")
                        scheduleRestart(500)
                    }
                    SpeechRecognizer.ERROR_CLIENT -> {
                        // Client side error - restart
                        scheduleRestart(200)
                    }
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
                        onError("Microphone permission required")
                        // Don't restart - permission issue
                    }
                    else -> {
                        scheduleRestart(500)
                    }
                }
            }

            override fun onResults(results: Bundle?) {
                Log.d(TAG, "Final results received")
                isListening = false

                val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                if (!matches.isNullOrEmpty()) {
                    val transcript = matches[0]
                    Log.d(TAG, "✅ Final: $transcript")
                    onTranscript(transcript, true)
                }

                // Restart for continuous listening
                scheduleRestart()
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                if (!matches.isNullOrEmpty()) {
                    val transcript = matches[0]
                    Log.d(TAG, "📝 Interim: $transcript")
                    onTranscript(transcript, false)
                }
            }

            override fun onEvent(eventType: Int, params: Bundle?) {
                Log.d(TAG, "Event: $eventType")
            }
        }
    }

    private fun scheduleRestart(delayMs: Long = RESTART_DELAY_MS) {
        if (!shouldBeListening) return

        restartJob?.cancel()
        restartJob = scope.launch {
            delay(delayMs)
            if (shouldBeListening && !isListening) {
                startListening()
            }
        }
    }

    private fun getErrorMessage(error: Int): String {
        return when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
            SpeechRecognizer.ERROR_CLIENT -> "Client side error"
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Insufficient permissions"
            SpeechRecognizer.ERROR_NETWORK -> "Network error"
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
            SpeechRecognizer.ERROR_NO_MATCH -> "No speech match"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
            SpeechRecognizer.ERROR_SERVER -> "Server error"
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Speech timeout"
            else -> "Unknown error"
        }
    }

    fun destroy() {
        stop()
        scope.cancel()
    }
}
