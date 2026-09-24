# The Amazing Spider-Man — a live comic

A one-page interactive comic built in plain JavaScript (`comic.js`). `index.html` is a three-line loader.
Open `index.html` in a browser and click **Open the comic**. The page has no sound.

- **It draws itself in time with its theme song.** The panels start as rough pencils with construction lines and hatching.
  Then they get inked in black & white, fill with colour panel by panel, and switch to Ben-Day halftone on the last line.
- **Theme song:** the lyrics of an original theme song scroll karaoke-style in the bottom bar, in time with the drawing.
- **Hover:** panels tilt. Spider-Man aims his web-shooter and turns his eyes toward your cursor.
  Spider-sense tingles get stronger, Scrapjaw's targeting laser follows you, and hidden speech balloons appear.
- **Click:** a colour splash shows the finished art through the pencils. Each panel also does its own thing:
  THWIP web shots, laser blasts, POW/BAM hits (land 5 and Scrapjaw goes KRA-KOOM), and fireworks at the end.

All art is procedural canvas drawing. There are no image files.
The only external resource is two Google Fonts, and the page falls back to system fonts if they don't load.
