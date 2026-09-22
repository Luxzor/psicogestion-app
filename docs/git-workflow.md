# Flujo de trabajo en Git

Este documento define cómo se organizan las ramas del repositorio y el
flujo que sigue el código desde que se empieza a programar una
funcionalidad hasta que llega a `main`.

## Ramas principales

| Rama                         | Propósito                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `main`                       | Código estable y entregado. Nadie hace push directo aquí.                                                                            |
| `develop`                    | Integración de las funcionalidades de la iteración en curso.                                                                         |
| `release/<nombre-iteracion>` | Se abre cuando el alcance de la iteración se congela y entra a pruebas. Solo recibe correcciones de bugs, no funcionalidades nuevas. |

## Ramas de trabajo

| Prefijo       | Cuándo se usa                              | Sale de                                         | Se integra en                 |
| ------------- | ------------------------------------------ | ----------------------------------------------- | ----------------------------- |
| `feature/...` | Nueva funcionalidad                        | `develop`                                       | `develop`                     |
| `bugfix/...`  | Corrección de un bug encontrado en pruebas | `release/...` (o `develop` si se detecta antes) | la misma rama de la que salió |
| `hotfix/...`  | Corrección urgente ya en producción        | `main`                                          | `main` y `develop`            |

### Convención de nombres

```
feature/<numero-EDT>-<descripcion-corta>-<persona, si aplica>
bugfix/<descripcion-corta>
hotfix/<descripcion-corta>
```

- Minúsculas, palabras separadas por guiones (`-`), no espacios ni guiones bajos.
- El número de cronograma (ej. `3.3.1`) ayuda a rastrear contra qué requisito corresponde la rama.
- **Si dos personas trabajan la misma funcionalidad en paralelo, cada quien usa
  su propia sub-rama agregando su nombre al final, y luego se integran entre
  ellas antes de ir a `develop`.**

**Ejemplos:**

```
feature/3.3.1-registro-usuarios
feature/3.3.1-registro-usuarios-mafer
feature/3.3.1-registro-usuarios-luis
bugfix/telefono-formato-validacion
```

## Flujo completo

```
main
 └─ release/iteracion-1
     └─ develop
         ├─ feature/3.3.4-cierre-sesion
         └─ bugfix/...
```

1. El trabajo de cada funcionalidad se hace en una rama `feature/...` que
   sale de `develop`.
2. Al terminar, se abre un Pull Request hacia `develop`. Nada se mergea sin
   revisión.
3. Cuando el alcance de la iteración está completo en `develop`, se abre
   `release/<nombre-iteracion>` para estabilizar: aquí se ejecutan las
   pruebas del diseño de pruebas y se corrigen los bugs que aparezcan
   (en su propia `bugfix/...` si el cambio es grande, o directo si es menor).
4. Cuando `release/...` pasa las pruebas, se mergea a `main` y se marca con
   un tag de versión (ej. `v1.0.0-iteracion1`). Ese punto es el que se
   documenta como línea base en `/07_Lineas_Base/` en Teams.
5. `release/...` también se mergea de vuelta a `develop` para que las
   correcciones no se pierdan en la siguiente iteración.

## Reglas generales

- No se hace push directo a `main` ni a `develop`; todo entra por Pull Request.
- Cada Pull Request debe referenciar el RF y número de cronograma que resuelve.
- Una rama `feature/` se elimina una vez mergeada, para no acumular ramas
  muertas en el repositorio.
