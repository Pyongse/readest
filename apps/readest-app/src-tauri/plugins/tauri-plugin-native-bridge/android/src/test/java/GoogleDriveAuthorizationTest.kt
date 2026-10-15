package com.readest.native_bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class GoogleDriveAuthorizationTest {
    @Test
    fun acceptedGrantReturnsToken() {
        assertEquals(
            "test-token",
            GoogleDriveAuthorization.validateToken("test-token", listOf(GoogleDriveAuthorization.SCOPE)),
        )
    }

    @Test
    fun missingDrivePermissionRejectsEvenWhenTokenExists() {
        val error = assertThrows(IllegalStateException::class.java) {
            GoogleDriveAuthorization.validateToken("test-token", listOf("openid"))
        }
        assertEquals("AUTHORIZATION_REQUIRED: Google Drive permission was not granted", error.message)
    }

    @Test
    fun missingTokenRejectsEvenWhenPermissionExists() {
        for (token in listOf(null, "", " ")) {
            assertThrows(IllegalStateException::class.java) {
                GoogleDriveAuthorization.validateToken(token, listOf(GoogleDriveAuthorization.SCOPE))
            }
        }
    }

    @Test
    fun silentAuthorizationCannotLaunchResolution() {
        val error = assertThrows(IllegalStateException::class.java) {
            GoogleDriveAuthorization.requireInteractive(false)
        }
        assertEquals("AUTHORIZATION_REQUIRED: Reconnect Google Drive to grant access", error.message)
        GoogleDriveAuthorization.requireInteractive(true)
    }

    @Test
    fun canceledAuthorizationCannotReturnAToken() {
        val error = assertThrows(IllegalStateException::class.java) {
            GoogleDriveAuthorization.requireAcceptedResult(false)
        }
        assertEquals("AUTHORIZATION_CANCELLED: Google Drive authorization was cancelled", error.message)
        GoogleDriveAuthorization.requireAcceptedResult(true)
    }
}
