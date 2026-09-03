from django.urls import path

from .views import (
    ApplicationView,
    ApplicationsView,
    AuthConfigView,
    DeleteAccountView,
    EmailAuthView,
    HhVacanciesView,
    LogoutView,
    MeView,
    ProfileView,
    PasswordView,
    ResumeView,
    SavedJobsView,
    TelegramAuthView,
)


urlpatterns = [
    path("vacancies/hh/", HhVacanciesView.as_view()),
    path("auth/config/", AuthConfigView.as_view()),
    path("auth/me/", MeView.as_view()),
    path("auth/email/", EmailAuthView.as_view()),
    path("auth/telegram/", TelegramAuthView.as_view()),
    path("auth/logout/", LogoutView.as_view()),
    path("auth/password/", PasswordView.as_view()),
    path("auth/account/", DeleteAccountView.as_view()),
    path("profile/", ProfileView.as_view()),
    path("profile/saved/", SavedJobsView.as_view()),
    path("profile/resume/", ResumeView.as_view()),
    path("applications/", ApplicationsView.as_view()),
    path("applications/<int:job_id>/", ApplicationView.as_view()),
]
