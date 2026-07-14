plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
}

@OptIn(org.jetbrains.kotlin.gradle.ExperimentalWasmDsl::class)
kotlin {
    jvm()
    js {
        browser {
        }
        binaries.executable()
    }
    wasmJs {
        compilerOptions {
            freeCompilerArgs.add("-Xwasm-use-new-exception-handling")
        }
        browser {
            testTask {
                useKarma {
                    useChromeHeadless()
                }
            }
        }
        binaries.executable()
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlin.coroutines)
            implementation(libs.kotlin.serialization)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
            implementation(libs.kotlin.coroutines.test)
        }
        jvmTest.dependencies {
            implementation(libs.junit5.api)
            runtimeOnly(libs.junit5.engine)
        }
    }
}
