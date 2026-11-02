# Disco

Extensión de GNOME que pone en la barra de arriba la portada de lo que está sonando.

- **Música** (Spotify, YouTube Music, SoundCloud, Rhythmbox, Amberol…): la portada se ve como un
  disco de vinil y **gira mientras suena**. En pausa se detiene.
- **Videos** (YouTube, Netflix, cualquier video en Brave o Firefox): la portada se ve como una
  miniatura quieta.
- **Al picarle:** portada grande, canción, artista y los botones de **anterior, pausa y siguiente**.
  Si suenan varias cosas (Spotify y un video), abajo sale **También suena** para cambiar cuál
  mostrar. **Abrir…** te lleva a la app.
- Cuando no suena nada, el ícono desaparece.

## Cómo sabe qué suena
Usa MPRIS, el estándar con el que los reproductores de Linux avisan qué tocan (el mismo que usan
los controles de música de GNOME). Spotify, Brave, Chrome, Firefox y casi todos los reproductores
lo tienen. Para distinguir música de video mira la app (Spotify, Rhythmbox…), la página
(music.youtube.com, open.spotify.com…) y si la pista trae álbum.

Las portadas se guardan en `~/.cache/disco/` (las últimas 40).

## Instalar
```bash
git clone https://github.com/DimitriMedNov/disco.git
cd disco
./install.sh
```
Cierra sesión y vuelve a entrar. Funciona en GNOME 48 a 51. `./install.sh --quitar` la quita.

## Cómo funciona
| Archivo | Qué hace |
|---|---|
| `extension.js` | El ícono de la barra (disco que gira o miniatura) y el menú con los controles |
| `reproductores.js` | Lista de reproductores, cuál mostrar y si es música o video |
| `portadas.js` | Baja o copia la portada a `~/.cache/disco` |

## Licencia
MIT.
