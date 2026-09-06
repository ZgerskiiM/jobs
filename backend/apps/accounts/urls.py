from django.urls import path

from .views import (
    ApplicationView,
    ApplicationsView,
    AuthConfigView,
    DeleteAccountView,
    EmailAuthView,
    ExtensionDownloadView,
    ExtensionApplicationView,
    HhVacanciesView,
    LogoutView,
    MeView,
    ProfileView,
    PasswordView,
    ResumeView,
    ResumeFileView,
    SavedJobsView,
    ScoringRankView,
    TelegramAuthView,
)


urlpatterns = [
    path("vacancies/hh/", HhVacanciesView.as_view()),
    path("extension/download/", ExtensionDownloadView.as_view()),
    path("extension/download/<str:browser>/", ExtensionDownloadView.as_view()),
    path("applications/from-extension/", ExtensionApplicationView.as_view()),
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
    path("profile/resume/file/", ResumeFileView.as_view()),
    path("scoring/rank/", ScoringRankView.as_view()),
    path("applications/", ApplicationsView.as_view()),
    path("applications/<int:job_id>/", ApplicationView.as_view()),
]
