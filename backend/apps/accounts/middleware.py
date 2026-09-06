from django.conf import settings
from django.contrib.auth import login
from django.core.exceptions import ImproperlyConfigured

from .models import User
from .services import get_profile


class LocalAuthBypassMiddleware:
    """Authenticate local development requests as one shared test account."""

    def __init__(self, get_response):
        self.get_response = get_response
        if settings.LOCAL_AUTH_BYPASS and not settings.DEBUG:
            raise ImproperlyConfigured("LOCAL_AUTH_BYPASS can only be enabled with DJANGO_DEBUG=1")

    def __call__(self, request):
        if settings.LOCAL_AUTH_BYPASS:
            # Local development deliberately has no authentication boundary.
            # Keeping CSRF enabled here would reject writes when the automatic
            # login rotates a session/token during the same request.
            request._dont_enforce_csrf_checks = True

        if settings.LOCAL_AUTH_BYPASS and not request.user.is_authenticated:
            user, _ = User.objects.get_or_create(
                email=settings.LOCAL_AUTH_EMAIL,
                defaults={"name": settings.LOCAL_AUTH_NAME},
            )
            if not user.name:
                user.name = settings.LOCAL_AUTH_NAME
                user.save(update_fields=["name"])
            get_profile(user)
            login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return self.get_response(request)
