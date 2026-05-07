#!/usr/bin/env python3
"""Fix UTF-8 mojibake in mail templates.

Templates were saved with truncated multi-byte UTF-8 sequences (e.g. ★ U+2605 = E2 98 85
became just E2 → "â"). This restores intent using HTML numeric entities.
"""
import re, sys, pathlib

# (pattern, replacement) — order matters: stars first (their â sequences
# overlap with single-â arrow/dash patterns), then specific icons, then arrows/dashes.
GLOBAL_FIXES = [
    # ── Star ratings ──────────────────────────────────────────────
    ('âââââ', '&#9733;&#9733;&#9733;&#9733;&#9733;'),
    ('ââââ+', '&#9733;&#9733;&#9733;&#9733;+'),
    ('ââââ<span style="color: #dddddd">â</span>',
     '&#9733;&#9733;&#9733;&#9733;<span style="color: #dddddd">&#9733;</span>'),

    # ── Promise / perk icons ─────────────────────────────────────
    ('ð°', '&#128176;'),    # 💰 money bag (Best Price)
    ('ð¡ï¸', '&#128737;&#65039;'),  # 🛡️ shield (Secure)
    ('â¡', '&#9889;'),       # ⚡ lightning (Instant)
    ('ð¨', '&#127976;'),    # 🏨 hotel
    ('âï¸', '&#9992;&#65039;'),  # ✈️ plane (Flights)

    # ── Service / banner icons ────────────────────────────────────
    ('ðï¸', '&#127960;&#65039;'),  # 🏖️ beach (Holidays)
    ('ð¢', '&#128674;'),     # 🚢 ship (Cruises)
    ('ð¯', '&#127919;'),     # 🎯 target (Activities / Best Price perk)
    ('ð´', '&#127796;'),     # 🌴 palm tree (banner)
    ('ð¸ð¬', '&#127480;&#127468;'),  # 🇸🇬 Singapore flag

    # ── Punctuation in body text ──────────────────────────────────
    ('Â·', '&middot;'),

    # ── Button arrows (must come after star fixes that consumed â chars) ──
    ('View Package â', 'View Package &rarr;'),
    ('Book Now â', 'Book Now &rarr;'),

    # ── Em-dashes in body text ────────────────────────────────────
    ('Singapore â Holidays', 'Singapore &mdash; Holidays'),
    ('Discover Singapore â', 'Discover Singapore &mdash;'),
    ('cruises and visa â', 'cruises and visa &mdash;'),
]

# Per-file fixes for the ambiguous lone "ð" and "â" cases
PER_FILE = {
    'day1-welcome-emailer.html': [
        # Visas service icon (between Cruises ð¢ and Activities ð¯, in 24px-span context)
        ('font-size: 24px;\n                                line-height: 45px;\n                              "\n                              >ð</span',
         'font-size: 24px;\n                                line-height: 45px;\n                              "\n                              >&#128203;</span'),  # 📋 passport
        # Promise card "Secure" lock — same line-height: 44px context as ð°
        ('line-height: 44px;\n                                  color: #1a1a1a;\n                                "\n                              >\n                                ð\n                              </div>',
         'line-height: 44px;\n                                  color: #1a1a1a;\n                                "\n                              >\n                                &#128274;\n                              </div>'),  # 🔒 lock
    ],
    'day2-cruise-emailer.html': [
        ('line-height: 44px;\n                                  color: #1a1a1a;\n                                "\n                              >\n                                ð\n                              </div>',
         'line-height: 44px;\n                                  color: #1a1a1a;\n                                "\n                              >\n                                &#128274;\n                              </div>'),
    ],
    'day3-visa-emailer.html': [
        ('line-height: 44px;\n                                  color: #1a1a1a;\n                                "\n                              >\n                                ð\n                              </div>',
         'line-height: 44px;\n                                  color: #1a1a1a;\n                                "\n                              >\n                                &#128274;\n                              </div>'),
    ],
    'day4-holidays-emailer.html': [
        # First ð in perk-grid (Transfers, between 🏨 Hotel and 🎯 Best Price), 24px context
        ('font-size: 24px;\n                          line-height: 24px;\n                          padding-bottom: 8px;\n                        "\n                      >\n                        ð\n                      </div>',
         'font-size: 24px;\n                          line-height: 24px;\n                          padding-bottom: 8px;\n                        "\n                      >\n                        &#128663;\n                      </div>'),  # 🚗 car (Transfers)
        # Second ð in promise card (Secure), 44px context
        ('line-height: 44px;\n                                  color: #1a1a1a;\n                                "\n                              >\n                                ð\n                              </div>',
         'line-height: 44px;\n                                  color: #1a1a1a;\n                                "\n                              >\n                                &#128274;\n                              </div>'),
        # Eid offer star prefix: "â Exclusive Eid Offer"
        ('â Exclusive Eid Offer', '&#10024; Exclusive Eid Offer'),  # ✨
    ],
}

def fix_file(path: pathlib.Path) -> dict:
    text = path.read_text(encoding='utf-8')
    counts = {}
    for old, new in GLOBAL_FIXES:
        c = text.count(old)
        if c:
            text = text.replace(old, new)
            counts[old[:30]] = c
    for old, new in PER_FILE.get(path.name, []):
        c = text.count(old)
        if c:
            text = text.replace(old, new)
            counts[f'[per-file] {old[:40]!r}'] = c
    path.write_text(text, encoding='utf-8')
    return counts

def main():
    root = pathlib.Path(__file__).parent
    for f in sorted(root.glob('*.html')):
        counts = fix_file(f)
        print(f'\n{f.name}:')
        for k, v in counts.items():
            print(f'  {v}x  {k}')
        # Sanity: any mojibake left?
        leftover = re.findall(r'[âð][^\s<>"a-zA-Z0-9&]*', f.read_text(encoding='utf-8'))
        if leftover:
            print(f'  ⚠ remaining mojibake fragments: {set(leftover)}')

if __name__ == '__main__':
    main()
