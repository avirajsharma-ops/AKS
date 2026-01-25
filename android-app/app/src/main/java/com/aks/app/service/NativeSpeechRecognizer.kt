package com.aks.app.service

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import com.aks.app.utils.EventBus
import kotlinx.coroutines.*

/**
 * Native Speech Recognition service that provides continuous transcription.
 * This replaces WebView's speech recognition for more reliable mic access.
 */
class NativeSpeechRecognizer(private val context: Context) {
    
    companion object {
        private const val TAG = "NativeSpeechRecognizer"
    }
    
    private var speechRecognizer: SpeechRecognizer? = null
    private var isListening = false
    private var isPaused = false
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    
    /**
     * Initialize the speech recognizer
     */
    fun initialize() {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            Log.e(TAG, "Speech recognition not available on this device")
            return
        }
        
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
            setRecognitionListener(createListener())
        }
        
        Log.d(TAG, "Speech recognizer initialized")
    }
    
    /**
     * Start continuous listening
     */
    fun startListening() {
        if (isListening || isPaused) return
        
        isListening = true
        startRecognition()
        
        Log.d(TAG, "Started listening")
        EventBus.post(context, EventBus.Events.MONITORING_STARTED)
    }
    
    /**
     * Stop listening
     */
    fun stopListening() {
        isListening = false
        isPaused = false
        
        speechRecognizer?.cancel()
        
        Log.d(TAG, "Stopped listening")
        EventBus.post(context, EventBus.Events.MONITORING_STOPPED)
    }
    
    /**
     * Pause listening (e.g., when AI is speaking)
     */
    fun pauseListening() {
        if (!isListening || isPaused) return
        isPaused = true
        speechRecognizer?.cancel()
        Log.d(TAG, "Paused listening")
    }
    
    /**
     * Resume listening
     */
    fun resumeListening() {
        if (!isListening || !isPaused) return
        isPaused = false
        startRecognition()
        Log.d(TAG, "Resumed listening")
    }
    
    private fun startRecognition() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN") // English-India for Hinglish support
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 5000L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L)
        }
        
        try {
            speechRecognizer?.startListening(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Error starting recognition: ${e.message}")
            // Retry after delay
            scope.launch {
                delay(500)
                if (isListening && !isPaused) {
                    startRecognition()
                }
            }
        }
    }
    
    private fun createListener(): RecognitionListener = object : RecognitionListener {
        
        override fun onReadyForSpeech(params: Bundle?) {
            Log.d(TAG, "Ready for speech")
            EventBus.post(context, "SPEECH_READY")
        }
        
        override fun onBeginningOfSpeech() {
            Log.d(TAG, "Speech started")
            EventBus.post(context, "SPEECH_STARTED")
        }
        
        override fun onRmsChanged(rmsdB: Float) {
            // Send volume level to WebView for visualizations
            if (rmsdB > 2) {
                EventBus.post(context, "SPEECH_VOLUME", mapOf("volume" to rmsdB))
            }
        }
        
        override fun onBufferReceived(buffer: ByteArray?) {}
        
        override fun onEndOfSpeech() {
            Log.d(TAG, "Speech ended")
            EventBus.post(context, "SPEECH_ENDED")
        }
        
        override fun onError(error: Int) {
            val errorMessage = when (error) {
                SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
                SpeechRecognizer.ERROR_CLIENT -> "Client error"
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Insufficient permissions"
                SpeechRecognizer.ERROR_NETWORK -> "Network error"
                SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
                SpeechRecognizer.ERROR_NO_MATCH -> "No match found"
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
                SpeechRecognizer.ERROR_SERVER -> "Server error"
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Speech timeout"
                else -> "Unknown error: $error"
            }
            
            Log.e(TAG, "Recognition error: $errorMessage")
            
            // Auto-restart on certain errors
            if (isListening && !isPaused) {
                when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH,
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
                    SpeechRecognizer.ERROR_NETWORK,
                    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> {
                        // Restart recognition
                        scope.launch {
                            delay(300)
                            if (isListening && !isPaused) {
                                startRecognition()
                            }
                        }
                    }
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> {
                        // Wait longer and retry
                        scope.launch {
                            delay(1000)
                            if (isListening && !isPaused) {
                                startRecognition()
                            }
                        }
                    }
                }
            }
        }
        
        override fun onResults(results: Bundle?) {
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val transcript = matches?.firstOrNull() ?: ""
            
            if (transcript.isNotEmpty()) {
                Log.d(TAG, "Final transcript: $transcript")
                
                // Send final transcript to WebView
                EventBus.post(context, "NATIVE_TRANSCRIPT", mapOf(
                    "transcript" to transcript,
                    "isFinal" to true,
                    "timestamp" to System.currentTimeMillis()
                ))
            }
            
            // Auto-restart listening
            if (isListening && !isPaused) {
                scope.launch {
                    delay(100)
                    startRecognition()
                }
            }
        }
        
        override fun onPartialResults(partialResults: Bundle?) {
            val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val transcript = matches?.firstOrNull() ?: ""
            
            if (transcript.isNotEmpty()) {
                Log.d(TAG, "Partial transcript: $transcript")
                
                // Send interim transcript to WebView
                EventBus.post(context, "NATIVE_TRANSCRIPT", mapOf(
                    "transcript" to transcript,
                    "isFinal" to false,
                    "timestamp" to System.currentTimeMillis()
                ))
            }
        }
        
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }
    
    /**
     * Cleanup resources
     */
    fun destroy() {
        isListening = false
        isPaused = false
        scope.cancel()
        speechRecognizer?.destroy()
        speechRecognizer = null
        Log.d(TAG, "Speech recognizer destroyed")
    }
}
