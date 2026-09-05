from django.contrib import admin
from django.urls import include, path
from django.views.decorators.csrf import ensure_csrf_cookie
from django.http import JsonResponse
from django.db import connection


@ensure_csrf_cookie
def csrf(request):
    return JsonResponse({"ok": True})


def healthz(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()
    return JsonResponse({"ok": True})


urlpatterns = [
    path("healthz/", healthz),
    path("admin/", admin.site.urls),
    path("api/auth/csrf/", csrf),
    path("api/", include("apps.accounts.urls")),
]
