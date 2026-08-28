from pathlib import Path

from django.conf import settings
from django.contrib import admin
from django.http import FileResponse
from django.urls import include, path, re_path
from django.views.static import serve as static_serve

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/auth/', include('apps.accounts.urls')),
    path('api/v1/', include('apps.organizations.urls')),
    path('api/v1/', include('apps.contacts.urls')),
    path('api/v1/', include('apps.leads.urls')),
    path('api/v1/', include('apps.deals.urls')),
    path('api/v1/', include('apps.activities.urls')),
    path('api/v1/', include('apps.hr.urls')),
    path('api/v1/', include('apps.support.urls')),
    path('api/v1/analytics/', include('apps.analytics.urls')),
]

# When the frontend has been built (frontend/dist), serve it from Django so the
# whole app lives on one origin — handy for tunnels (ngrok) and simple deploys.
FRONTEND_DIST = Path(settings.BASE_DIR).parent / 'frontend' / 'dist'
if (FRONTEND_DIST / 'index.html').exists():

    def spa_index(request, *args, **kwargs):
        return FileResponse(open(FRONTEND_DIST / 'index.html', 'rb'))

    urlpatterns += [
        re_path(r'^assets/(?P<path>.*)$', static_serve, {'document_root': FRONTEND_DIST / 'assets'}),
        re_path(r'^(?!api/|admin/|assets/).*$', spa_index),
    ]
