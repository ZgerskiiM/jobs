from rest_framework import serializers


class EmailAuthSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, write_only=True)
    mode = serializers.ChoiceField(choices=["login", "register"], default="login")


class ProfilePatchSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=1, max_length=160, required=False)
    onboarding = serializers.JSONField(required=False, allow_null=True)
    settings = serializers.JSONField(required=False)
    coverLetter = serializers.CharField(max_length=10000, required=False, allow_blank=True)


class SavedJobSerializer(serializers.Serializer):
    jobId = serializers.IntegerField(min_value=1)
    saved = serializers.BooleanField(required=False)
    note = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class ApplicationSerializer(serializers.JSONField):
    pass
