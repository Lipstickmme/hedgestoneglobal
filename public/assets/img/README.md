# Supplied photography

Real artwork lives here. `../bank/` holds the generated placeholders and the
brand files; anything in this folder wins over a file of the same name there,
so a placeholder never outranks a photograph.

Any of `.webp`, `.avif`, `.jpg`, `.jpeg`, `.png` or `.svg` works, matched
without regard to case, best format first — so dropping a `.webp` beside a
heavy `.png` switches to it without deleting anything. The build says which
files it picked up, and warns if any photograph ends up used twice.

## What goes where

Every placement has its own slot and no photograph is used on two pages.
Rename a file to the name in the first column and it takes that place.

| Name                | Where it appears            | What suits it                                     |
| ------------------- | --------------------------- | ------------------------------------------------- |
| `hedgestonefamily`  | Home hero (arched frame)    | Cropped to a portrait: keep the people near the middle |
| `hedgestone2`       | Home security panel         | One person going through their money, unhurried    |
| `hedgestone1`       | `/personal` header          | The building, at dusk                              |
| `hedgestone5`       | `/business` header          | A conversation across a desk                       |
| `hedgestone4`       | `/rates` header             | Close, dark, physical: a vault door, a lock        |
| `hedgestone`        | `/security-center` header   | A branch interior, somebody being served           |
| `hedgestonehero`    | `/open-account` header      | A banker, face visible — reassurance               |
| `hedgestone3`       | `/careers` header           | Somebody at work, hands on the job                 |
| `hedgestone6`       | `/contact` header           | The office, as it actually looks                   |
| `story-logistics`   | Customer story              | Fleet, depot, freight                              |
| `story-property`    | Customer story              | A building going up                                |
| `story-retail`      | Customer story              | A shop floor                                       |
| `story-personal`    | Customer story              | A household at the kitchen table                   |

`/apply` and `/legal` carry no photograph. They get the mark drawn large and
faint instead, which is better than a tenth page borrowing a ninth page's
picture. Add slots for them in `src/data/images.json` if you would rather they
had their own.

Headers are cropped with `object-fit: cover`, so the aspect ratio matters less
than where the subject sits: keep faces and detail away from the left third,
which the type covers.
