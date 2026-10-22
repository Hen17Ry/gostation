# Configuration initiale de GlitchTip (scripts/prod.sh glitchtip-setup), exécutée par
# `manage.py shell` dans le conteneur glitchtip : compte administrateur (GLITCHTIP_ADMIN_EMAIL,
# GLITCHTIP_ADMIN_PASSWORD), organisation GoStation, son équipe et les projets api (API et
# worker), admin et mobile, IP des clients anonymisées. Idempotent : relancé, il ne crée rien de
# plus. N'affiche que les DSN (KEY=valeur), lus par scripts/staging.sh glitchtip-setup.
# Écrit pour GlitchTip 6.2 (modèles apps.organizations_ext, apps.projects, apps.teams).
import os
import sys

from django.contrib.auth import get_user_model

from apps.organizations_ext.constants import OrganizationUserRole
from apps.organizations_ext.models import Organization, OrganizationUser
from apps.projects.models import Project, ProjectKey
from apps.teams.models import Team

email = os.environ.get("GLITCHTIP_ADMIN_EMAIL", "").strip().lower()
password = os.environ.get("GLITCHTIP_ADMIN_PASSWORD", "")
if not email or not password:
    sys.exit("GLITCHTIP_ADMIN_EMAIL et GLITCHTIP_ADMIN_PASSWORD requis")

User = get_user_model()
user = User.objects.filter(email__iexact=email).first()
if user is None:
    user = User.objects.create_superuser(email=email, password=password)

org = Organization.objects.filter(name="GoStation").first()
if org is None:
    org = Organization.objects.create(name="GoStation")
org_user = OrganizationUser.objects.filter(organization=org, user=user).first()
if org_user is None:
    org_user = org.add_user(user, role=OrganizationUserRole.OWNER)

team, _ = Team.objects.get_or_create(organization=org, slug="gostation")
team.members.add(org_user)

# (projet, plateforme, variable de .env.production qui reçoit son DSN)
PROJECTS = [
    ("api", "go", "SENTRY_DSN"),
    ("admin", "javascript-react", "VITE_SENTRY_DSN"),
    ("mobile", "react-native", "MOBILE_SENTRY_DSN"),
]
for name, platform, var in PROJECTS:
    project = Project.objects.filter(organization=org, name=name).first()
    if project is None:
        project = Project.objects.create(organization=org, name=name, platform=platform)
    if not project.scrub_ip_addresses:
        project.scrub_ip_addresses = True
        project.save(update_fields=["scrub_ip_addresses"])
    team.projects.add(project)
    key = ProjectKey.objects.filter(project=project, is_active=True).order_by("pk").first()
    if key is None:
        key = ProjectKey.objects.create(project=project)
    dsn = key.get_dsn()
    if not dsn:
        sys.exit("DSN vide : GLITCHTIP_DOMAIN (URL publique de GlitchTip) absent de la configuration")
    print(f"{var}={dsn}")
