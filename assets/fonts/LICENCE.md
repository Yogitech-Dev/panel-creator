# Fonts in this folder

Latin subsets of the four faces yogitech.eu uses, self-hosted so the tool looks right offline and
makes no third-party request when it is embedded on the site.

| File | Family | Licence |
|---|---|---|
| `archivo-var.woff2` | Archivo (variable, 100-900) — Omnibus-Type | SIL Open Font License 1.1 |
| `martian-mono-400.woff2`, `martian-mono-700.woff2` | Martian Mono — Evil Martians | SIL Open Font License 1.1 |
| `newsreader-400.woff2` | Newsreader — Production Type | SIL Open Font License 1.1 |
| `quicksand-700.woff2` | Quicksand — Andrew Paglinawan | SIL Open Font License 1.1 |

All four are under the **SIL Open Font License 1.1**, which permits redistribution and web
embedding. The full licence text for each family, with its copyright line, is in this folder
(`OFL-archivo.txt`, `OFL-martianmono.txt`, `OFL-newsreader.txt`, `OFL-quicksand.txt`). Upstream:

* https://fonts.google.com/specimen/Archivo/license
* https://fonts.google.com/specimen/Martian+Mono/license
* https://fonts.google.com/specimen/Newsreader/license
* https://fonts.google.com/specimen/Quicksand/license

Only the latin subset is included (`U+0000-00FF` plus the usual punctuation), which is why the files
are small. Re-fetch them with the same subset if a family is ever updated.
