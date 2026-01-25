package com.aks.app

import android.app.Application
import com.aks.app.utils.NotificationHelper

class AKSApplication : Application() {
    
    override fun onCreate() {
        super.onCreate()
        
        // Create notification channel on app start
        NotificationHelper.createChannel(this)
    }
}
