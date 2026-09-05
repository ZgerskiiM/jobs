from celery import shared_task


@shared_task
def refresh_vacancies_task() -> str:
    """Integration point for the existing collector."""
    return "collector integration pending"
