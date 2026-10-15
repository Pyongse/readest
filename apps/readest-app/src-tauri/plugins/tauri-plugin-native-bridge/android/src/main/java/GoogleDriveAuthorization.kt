package com.readest.native_bridge

internal object GoogleDriveAuthorization {
    const val SCOPE = "https://www.googleapis.com/auth/drive.file"

    fun validateToken(accessToken: String?, grantedScopes: List<String>): String {
        check(SCOPE in grantedScopes) {
            "AUTHORIZATION_REQUIRED: Google Drive permission was not granted"
        }
        check(!accessToken.isNullOrBlank()) {
            "AUTHORIZATION_REQUIRED: Google Drive did not return an access token"
        }
        return accessToken
    }

    fun requireInteractive(interactive: Boolean) {
        check(interactive) {
            "AUTHORIZATION_REQUIRED: Reconnect Google Drive to grant access"
        }
    }

    fun requireAcceptedResult(accepted: Boolean) {
        check(accepted) {
            "AUTHORIZATION_CANCELLED: Google Drive authorization was cancelled"
        }
    }
}
