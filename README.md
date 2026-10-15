# Sudoku

Page web (pensée pour le téléphone) pour saisir une grille de Sudoku et se faire aider à la remplir.

## Fonctionnalités

- **Saisie** de l'énoncé, ou chargement d'un exemple ; la grille est vérifiée (doublons, solution unique) avant de commencer.
- **Résolution** : notes (crayon), candidats automatiques, annulation, vérification des erreurs.
- **Indices** expliqués (« dans cette ligne, le 7 ne peut aller qu'ici »), avec un bouton pour placer le chiffre.
- Sauvegarde automatique de la partie dans le navigateur.
- Au clavier : `1`–`9`, `Suppr`/`Retour arrière`, flèches, `N` pour les notes, `Ctrl+Z`.

À venir : scan d'une grille avec l'appareil photo.

## Lancer en local

Aucune dépendance ni compilation : ce sont des fichiers statiques. Les modules JavaScript ne se chargent pas en `file://`, il faut donc un petit serveur :

```bash
python -m http.server 8000
```

puis ouvrir <http://localhost:8000>.

## Déploiement

Publié avec GitHub Pages depuis la branche `main` (dossier racine).
