from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Application, AuditLog, PaymentEvent, Profile, Subscription, User


@admin.register(User)
class AccountUserAdmin(UserAdmin):
    ordering = ("-date_joined",)
    list_display = ("email", "name", "telegram_username", "role", "is_staff", "date_joined")
    search_fields = ("email", "name", "telegram_username", "telegram_id")
    fieldsets = (
        (None, {"fields": ("email", "password")} ),
        ("Профиль", {"fields": ("name", "telegram_id", "telegram_username", "telegram_photo_url", "role")} ),
        ("Права", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")} ),
        ("Даты", {"fields": ("last_login", "date_joined")} ),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "password1", "password2", "name", "role")} ),)


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "updated_at")
    search_fields = ("user__email", "user__name")


@admin.register(Application)
class ApplicationAdmin(admin.ModelAdmin):
    list_display = ("user", "job_id", "updated_at")
    search_fields = ("user__email", "user__name")


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ("user", "provider", "plan", "status", "ends_at")
    list_filter = ("provider", "status", "plan")
    search_fields = ("user__email", "external_id")


@admin.register(PaymentEvent)
class PaymentEventAdmin(admin.ModelAdmin):
    list_display = ("provider", "external_event_id", "processed_at", "created_at")
    readonly_fields = ("provider", "external_event_id", "payload", "processed_at", "created_at")


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "action", "actor", "object_type", "object_id")
    list_filter = ("action", "object_type")
    search_fields = ("actor__email", "object_id")
    readonly_fields = ("actor", "action", "object_type", "object_id", "metadata", "created_at")
