# OCR is optional. Preserve the reflection entry and model-specific factories.
-keep class cn.intentcomputing.kokoagentsdk.KokoMlKitOcr { *; }
-keep class cn.intentcomputing.kokoagentsdk.KokoMlKitOcr$* { *; }
# These types intentionally need not exist in a dump-only host's runtime.
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.tasks.**
