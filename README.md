# Sudoku

Page web (pensée pour le téléphone) pour saisir une grille de Sudoku et se faire aider à la remplir.

## Fonctionnalités

- **Scan** d'une grille avec l'appareil photo (ou une image de la galerie) : le cadre est détecté, on ajuste les 4 coins si besoin, et les chiffres douteux sont signalés en orange.
- **Saisie** de l'énoncé, ou chargement d'un exemple ; la grille est vérifiée (doublons, solution unique) avant de commencer.
- **Résolution** : notes (crayon), candidats automatiques, annulation, vérification des erreurs.
- **Indices** expliqués (« dans cette ligne, le 7 ne peut aller qu'ici »), avec un bouton pour placer le chiffre.
- Sauvegarde automatique de la partie dans le navigateur.
- Au clavier : `1`–`9`, `Suppr`/`Retour arrière`, flèches, `N` pour les notes, `Ctrl+Z`.

## Comment marche le scan

Tout se passe dans le navigateur, sans serveur ni bibliothèque (`scan.js`) :

1. **Cadre** : seuillage adaptatif, puis recherche du réseau de traits connectés qui ressemble le plus à un quadrillage 9×9.
2. **Redressement** : homographie qui ramène les 4 coins à un carré, relu dans la photo en haute résolution.
3. **Chiffres** : chaque case est comparée à des chiffres dessinés dans une dizaine de polices, puis à des modèles appris sur la grille elle-même (même police).
4. **Contrôle** : une case est douteuse si deux chiffres sont presque aussi ressemblants ; si la grille lue n'a pas de solution, on essaie de corriger une case douteuse.

`tests/scan.html` mesure la lecture sur des photos synthétiques (perspective, ombre, bruit, flou, plusieurs polices).

## Lancer en local

Aucune dépendance ni compilation : ce sont des fichiers statiques. Les modules JavaScript ne se chargent pas en `file://`, il faut donc un petit serveur :

```bash
python -m http.server 8000
```

puis ouvrir <http://localhost:8000>.

## Déploiement

Publié avec GitHub Pages depuis la branche `main` (dossier racine).
