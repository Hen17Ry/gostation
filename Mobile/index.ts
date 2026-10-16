// Point d'entrée : la tâche des actions de notification (« Rien n'a changé ») est définie avant
// tout le reste, pour qu'Android puisse la lancer quand l'app est tuée (src/features/notifications).
import './src/features/notifications/task'
import 'expo-router/entry'
