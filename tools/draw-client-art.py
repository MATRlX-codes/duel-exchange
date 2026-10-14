#!/usr/bin/env python3
"""
Draws the battle client's own art (no upstream images are used) into client/public/:
  fx/<effect>.png      the 58 move-effect sprites the animation code asks for, same names and sizes
  fx/weather-*.png/jpg weather and field tiles
  fx/bg-field.png      the battle field (Battle Tab palette: sky, grass, two platforms)
  fx/gender-*.png      gender marks
  img/capsule*.png     the party-slot icons (our capsule, not a franchise ball)
  img/avatar.svg       the trainer avatar
  sprites/<id>/        animated GIFs from our sprite strips (site/public/sprites), plus the icon
Run: python3 tools/draw-client-art.py   (needs Pillow). Output is committed.
"""
import math, os, random, shutil
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "client", "public")
SPRITES_IN = os.path.join(HERE, "..", "..", "site", "public", "sprites")
SS = 4  # supersample

def canvas(w, h):
    return Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))

def done(im, w, h, name, blur=0):
    if blur: im = im.filter(ImageFilter.GaussianBlur(blur * SS))
    im = im.resize((w, h), Image.LANCZOS)
    if "." not in name: name += ".png"
    os.makedirs(os.path.join(OUT, "fx"), exist_ok=True)
    im.save(os.path.join(OUT, "fx", name))

def hexc(s, a=255):
    s = s.lstrip("#"); return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)

def radial(w, h, inner, outer, core=0.0):
    im = canvas(w, h); px = im.load(); W, H = w * SS, h * SS
    cx, cy, r = W / 2, H / 2, min(W, H) / 2
    for y in range(H):
        for x in range(W):
            d = math.hypot(x - cx, y - cy) / r
            if d > 1: continue
            t = max(0.0, (d - core) / (1 - core)) if d > core else 0.0
            c = [int(inner[i] + (outer[i] - inner[i]) * t) for i in range(3)]
            a = int(inner[3] * (1 - t) ** 1.6 + outer[3] * 0)
            px[x, y] = (*c, max(0, min(255, a)))
    return im

def wisp(name, col):
    c = hexc(col)
    im = radial(100, 100, (min(255, c[0] + 60), min(255, c[1] + 60), min(255, c[2] + 60), 235), c, core=0.15)
    done(im, 100, 100, name, blur=2)

def ball(name, size, a, b, ring=None):
    im = radial(size, size, hexc(a, 255), hexc(b), core=0.35)
    d = ImageDraw.Draw(im); W = size * SS
    if ring:
        d.ellipse([W * .22, W * .22, W * .78, W * .78], outline=hexc(ring, 200), width=int(2 * SS))
    d.ellipse([W * .30, W * .24, W * .46, W * .38], fill=(255, 255, 255, 170))
    done(im, size, size, name, blur=0.6)

def poly(name, w, h, pts, fill, outline=None, width=2, blur=0):
    im = canvas(w, h); d = ImageDraw.Draw(im)
    P = [(x * w * SS, y * h * SS) for x, y in pts]
    d.polygon(P, fill=hexc(fill) if isinstance(fill, str) else fill)
    if outline: d.line(P + [P[0]], fill=hexc(outline), width=int(width * SS), joint="curve")
    done(im, w, h, name, blur)

def star(n, r1, r2, cx=.5, cy=.5, rot=-math.pi / 2):
    pts = []
    for i in range(n * 2):
        r = r1 if i % 2 == 0 else r2
        a = rot + i * math.pi / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def draw_effects():
    random.seed(7)
    for n, c in [("wisp", "#e9f3fc"), ("purplewisp", "#8b5cf6"), ("waterwisp", "#3b8fe0"), ("mudwisp", "#8a6a3c"), ("blackwisp", "#2a2440")]:
        wisp(n, c)
    ball("shadowball", 100, "#6d3fb8", "#1d1235", ring="#b48cff")
    ball("energyball", 100, "#a8f070", "#2f8a2a", ring="#e2ffc9")
    ball("electroball", 100, "#fff3a0", "#e0a800", ring="#ffffff")
    ball("mistball", 100, "#ffd0ec", "#d0679f", ring="#ffffff")
    ball("iceball", 100, "#e6fbff", "#4fb6d8", ring="#ffffff")
    ball("flareball", 100, "#fff0b0", "#e2541c", ring="#ffd27a")
    ball("fireball", 64, "#fff3c4", "#e8501e")
    ball("bluefireball", 64, "#e4f2ff", "#2f6fd0")
    # moon: crescent
    im = canvas(100, 100); d = ImageDraw.Draw(im); W = 100 * SS
    d.ellipse([W * .12, W * .12, W * .88, W * .88], fill=hexc("#fff6c9"))
    d.ellipse([W * .30, W * .04, W * .98, W * .74], fill=(0, 0, 0, 0))
    done(im, 100, 100, "moon", blur=0.4)
    # capsule (effect "pokeball" slot name kept because the animation code asks for it): a hex gem token
    poly("pokeball.png", 24, 24, [(.5, .04), (.92, .28), (.92, .72), (.5, .96), (.08, .72), (.08, .28)], "#2f6fd0", "#1f2d44", 1.5)
    for n, a in [("icicle", "#bfefff"), ("icicle-pink", "#ffc6e6")]:
        poly(n + ".png", 80, 60, [(.02, .5), (.98, .18), (.86, .5), (.98, .82)], a, "#ffffff", 1.5)
    # lightning
    im = canvas(41, 229); d = ImageDraw.Draw(im)
    pts = [(.55, 0), (.25, .32), (.6, .36), (.2, .7), (.55, .72), (.35, 1)]
    d.line([(x * 41 * SS, y * 229 * SS) for x, y in pts], fill=hexc("#fff27a"), width=7 * SS, joint="curve")
    d.line([(x * 41 * SS, y * 229 * SS) for x, y in pts], fill=(255, 255, 255, 255), width=3 * SS, joint="curve")
    done(im, 41, 229, "lightning.png", blur=0.3)
    poly("rocks.png", 100, 100, [(.1, .7), (.3, .35), (.55, .3), (.8, .45), (.92, .75), (.6, .92), (.3, .9)], "#8d7f6a", "#4e4538", 2)
    poly("rock1.png", 64, 80, [(.15, .8), (.25, .3), (.6, .08), (.88, .4), (.8, .9), (.4, .96)], "#9a8a72", "#4e4538", 2)
    poly("rock2.png", 66, 72, [(.1, .6), (.35, .12), (.8, .2), (.94, .62), (.6, .94), (.2, .88)], "#857560", "#4e4538", 2)
    poly("rock3.png", 66, 72, [(.08, .5), (.4, .08), (.9, .3), (.85, .8), (.45, .95)], "#a59a86", "#4e4538", 2)
    for n, w, h, c in [("leaf1", 32, 26, "#4caf3c"), ("leaf2", 40, 26, "#69c24f"), ("petal", 60, 60, "#ff9fcf")]:
        im = canvas(w, h); d = ImageDraw.Draw(im); W, H = w * SS, h * SS
        d.ellipse([W * .05, H * .2, W * .95, H * .8], fill=hexc(c))
        d.line([(W * .1, H * .5), (W * .9, H * .5)], fill=hexc("#ffffff", 120), width=SS)
        done(im, w, h, n + ".png")
    im = canvas(29, 29); d = ImageDraw.Draw(im); W = 29 * SS
    d.line([(W * .2, W * .8), (W * .8, W * .2)], fill=hexc("#efe6cf"), width=6 * SS)
    for x, y in [(.18, .72), (.28, .82), (.72, .18), (.82, .28)]: d.ellipse([W * x - 3 * SS, W * y - 3 * SS, W * x + 3 * SS, W * y + 3 * SS], fill=hexc("#efe6cf"))
    done(im, 29, 29, "bone.png")
    poly("caltrop.png", 80, 80, star(4, .45, .14), "#9aa6b8", "#3c4658", 2)
    poly("poisoncaltrop.png", 80, 80, star(4, .45, .14), "#9a63c4", "#3a2150", 2)
    poly("greenmetal1.png", 45, 45, [(.5, .05), (.93, .3), (.93, .7), (.5, .95), (.07, .7), (.07, .3)], "#6cc28a", "#2e6b45", 2)
    poly("greenmetal2.png", 45, 45, [(.3, .06), (.94, .2), (.8, .9), (.08, .76)], "#59b07a", "#2e6b45", 2)
    # fists / foot: chunky mitten shapes
    for n, w, h, flip in [("fist", 55, 49, False), ("fist1", 49, 55, True)]:
        im = canvas(w, h); d = ImageDraw.Draw(im); W, H = w * SS, h * SS
        d.rounded_rectangle([W * .1, H * .15, W * .9, H * .85], radius=10 * SS, fill=hexc("#f2d2b0"), outline=hexc("#5a3b22"), width=2 * SS)
        for i in range(3): d.line([(W * (.35 + i * .18), H * .2), (W * (.35 + i * .18), H * .5)], fill=hexc("#5a3b22"), width=2 * SS)
        if flip: im = im.rotate(90, expand=False)
        done(im, w, h, n + ".png")
    im = canvas(50, 75); d = ImageDraw.Draw(im); W, H = 50 * SS, 75 * SS
    d.rounded_rectangle([W * .2, H * .05, W * .8, H * .95], radius=14 * SS, fill=hexc("#f2d2b0"), outline=hexc("#5a3b22"), width=2 * SS)
    done(im, 50, 75, "foot.png")
    for n, top in [("topbite", True), ("bottombite", False)]:
        pts = []
        for i in range(7):
            x0, x1 = i / 7, (i + 1) / 7
            pts += [(x0, 0 if top else 1), ((x0 + x1) / 2, .9 if top else .1), (x1, 0 if top else 1)]
        poly(n + ".png", 108, 64, [(0, 0 if top else 1)] + pts + [(1, 0 if top else 1)], "#ffffff", "#9aa6b8", 1.5)
    im = canvas(120, 122); d = ImageDraw.Draw(im); W, H = 120 * SS, 122 * SS
    for i in range(8):
        a = i * math.pi / 4; d.line([(W / 2, H / 2), (W / 2 + W * .48 * math.cos(a), H / 2 + H * .48 * math.sin(a))], fill=hexc("#ffffff", 220), width=SS * 2)
    for r in (.14, .26, .38): d.ellipse([W * (.5 - r), H * (.5 - r), W * (.5 + r), H * (.5 + r)], outline=hexc("#ffffff", 200), width=SS * 2)
    done(im, 120, 122, "web.png")
    for n, w, h, k in [("leftclaw", 44, 60, -1), ("rightclaw", 44, 60, 1), ("leftslash", 57, 56, -1), ("rightslash", 57, 56, 1)]:
        im = canvas(w, h); d = ImageDraw.Draw(im); W, H = w * SS, h * SS
        lines = 3 if "claw" in n else 1
        for i in range(lines):
            off = (i - (lines - 1) / 2) * W * .22
            x0, x1 = (W * .15, W * .85) if k > 0 else (W * .85, W * .15)
            d.line([(x0 + off, H * .1), (x1 + off, H * .9)], fill=hexc("#ffffff"), width=(4 if lines > 1 else 7) * SS)
        done(im, w, h, n + ".png", blur=0.4)
    for n, k in [("leftchop", -1), ("rightchop", 1)]:
        im = canvas(100, 130); d = ImageDraw.Draw(im); W, H = 100 * SS, 130 * SS
        d.arc([W * (-.3 if k > 0 else .3), H * .05, W * (1.0 if k > 0 else 1.6), H * .95], 300 if k > 0 else 120, 60 if k > 0 else 240, fill=hexc("#ffffff"), width=9 * SS)
        done(im, 100, 130, n + ".png", blur=0.6)
    im = canvas(30, 30); d = ImageDraw.Draw(im); W = 30 * SS
    for a in (0, 90, 180, 270):
        r = math.radians(a); cx, cy = W / 2 + math.cos(r) * W * .22, W / 2 + math.sin(r) * W * .22
        d.line([(cx - W * .12, cy - W * .12), (cx + W * .12, cy + W * .12)], fill=hexc("#e5483b"), width=3 * SS)
    done(im, 30, 30, "angry.png")
    im = canvas(30, 30); d = ImageDraw.Draw(im); W = 30 * SS
    d.ellipse([W * .1, W * .15, W * .52, W * .55], fill=hexc("#ff6f9f")); d.ellipse([W * .48, W * .15, W * .9, W * .55], fill=hexc("#ff6f9f"))
    d.polygon([(W * .12, W * .42), (W * .88, W * .42), (W * .5, W * .9)], fill=hexc("#ff6f9f"))
    done(im, 30, 30, "heart.png")
    poly("pointer.png", 100, 100, [(.1, .4), (.6, .4), (.6, .2), (.95, .5), (.6, .8), (.6, .6), (.1, .6)], "#f0a800", "#8a6100", 2)
    poly("sword.png", 48, 100, [(.5, .02), (.64, .7), (.9, .72), (.9, .78), (.58, .8), (.58, .98), (.42, .98), (.42, .8), (.1, .78), (.1, .72), (.36, .7)], "#dfe7f2", "#4b5a70", 1.5)
    poly("impact.png", 127, 119, star(8, .48, .22), "#fff6c9", "#f0a800", 2, blur=0.3)
    im = canvas(100, 35); d = ImageDraw.Draw(im); W, H = 100 * SS, 35 * SS
    for cx in (.28, .72):
        d.ellipse([W * (cx - .16), H * .15, W * (cx + .16), H * .85], fill=hexc("#ffffff"), outline=hexc("#1f2d44"), width=2 * SS)
        d.ellipse([W * (cx - .05), H * .32, W * (cx + .05), H * .68], fill=hexc("#e5483b"))
    done(im, 100, 35, "stare.png")
    poly("shine.png", 127, 119, star(4, .48, .08), "#ffffff", None, blur=0.4)
    poly("feather.png", 100, 38, [(.02, .5), (.3, .1), (.8, .2), (.98, .5), (.8, .8), (.3, .9)], "#f3f6fb", "#9aa6b8", 1.5)
    im = canvas(100, 91); d = ImageDraw.Draw(im); W, H = 100 * SS, 91 * SS
    d.pieslice([W * .05, H * .1, W * .95, H * 1.6], 180, 360, fill=hexc("#f6c9a8"), outline=hexc("#8a5a3a"), width=2 * SS)
    for i in range(1, 5): d.line([(W / 2, H * .85), (W * (.05 + i * .18), H * .2)], fill=hexc("#8a5a3a"), width=2 * SS)
    done(im, 100, 91, "shell.png")
    poly("gear.png", 100, 100, star(10, .46, .36), "#9aa6b8", "#3c4658", 2)
    im = Image.open(os.path.join(OUT, "fx", "gear.png")); d = ImageDraw.Draw(im); d.ellipse([38, 38, 62, 62], fill=(0, 0, 0, 0)); im.save(os.path.join(OUT, "fx", "gear.png"))
    poly("alpha.png", 80, 80, [(.5, .08), (.92, .9), (.08, .9)], (0, 0, 0, 0), "#e5483b", 5)
    im = canvas(80, 80); d = ImageDraw.Draw(im); W = 80 * SS
    d.ellipse([W * .1, W * .1, W * .9, W * .9], outline=hexc("#2f6fd0"), width=5 * SS)
    done(im, 80, 80, "omega.png")
    im = canvas(128, 128); d = ImageDraw.Draw(im); W = 128 * SS
    for i, c in enumerate(["#e5483b", "#f0a800", "#f2c230", "#2fbf55", "#2f6fd0", "#8b5cf6"]):
        r = .48 - i * .05; d.arc([W * (.5 - r), W * (.5 - r) + W * .2, W * (.5 + r), W * (.5 + r) + W * .2], 180, 360, fill=hexc(c), width=int(W * .05))
    done(im, 128, 128, "rainbow.png", blur=0.3)
    poly("z-symbol.png", 150, 100, [(.1, .1), (.9, .1), (.35, .78), (.9, .78), (.9, .92), (.1, .92), (.65, .24), (.1, .24)], "#f0a800", "#8a6100", 2)
    poly("ultra.png", 113, 165, [(.5, .02), (.95, .5), (.5, .98), (.05, .5)], "#fff6c9", "#f0a800", 3, blur=0.3)
    im = canvas(100, 100); d = ImageDraw.Draw(im); W = 100 * SS
    for a in (45, 135, 225, 315):
        r = math.radians(a); d.line([(W / 2 + math.cos(r) * W * .12, W / 2 + math.sin(r) * W * .12), (W / 2 + math.cos(r) * W * .42, W / 2 + math.sin(r) * W * .42)], fill=hexc("#ffffff"), width=6 * SS)
    done(im, 100, 100, "hitmarker.png")

def tile(name, w, h, top, bottom, specks=None, streaks=None, rgb=False):
    im = Image.new("RGBA", (w, h)); px = im.load()
    a, b = hexc(top[0], top[1]), hexc(bottom[0], bottom[1])
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))
        for x in range(w): px[x, y] = c
    d = ImageDraw.Draw(im); random.seed(name)
    if specks:
        col, n, r = specks
        for _ in range(n):
            x, y = random.randrange(w), random.randrange(h); d.ellipse([x - r, y - r, x + r, y + r], fill=hexc(col, 150))
    if streaks:
        col, n, dx = streaks
        for _ in range(n):
            x, y = random.randrange(w), random.randrange(h); d.line([(x, y), (x + dx, y + 18)], fill=hexc(col, 140), width=1)
    path = os.path.join(OUT, "fx", name)
    (im.convert("RGB") if rgb else im).save(path, quality=88) if rgb else im.save(path)

def draw_weather():
    W, H = 640, 360
    tile("weather-sunnyday.jpg", W, H, ("#ffd27a", 255), ("#fff3d6", 255), rgb=True)
    tile("weather-raindance.jpg", W, H, ("#3f5f8f", 255), ("#7d9cc4", 255), streaks=("#e9f3fc", 260, -6), rgb=True)
    tile("weather-sandstorm.png", W, H, ("#c9a66b", 150), ("#e3c995", 150), specks=("#8a6a3c", 500, 1))
    tile("weather-hail.png", W, H, ("#cfe9f7", 140), ("#eef7fc", 140), specks=("#ffffff", 260, 2))
    tile("weather-strongwind.png", W, H, ("#bfddf7", 110), ("#e9f3fc", 110), streaks=("#ffffff", 120, 60))
    tile("weather-electricterrain.png", W, H, ("#fff3a0", 90), ("#f2c230", 120), specks=("#ffffff", 120, 1))
    tile("weather-grassyterrain.png", W, H, ("#cfe8c0", 90), ("#69c24f", 120), specks=("#2f8a2a", 160, 1))
    tile("weather-mistyterrain.png", W, H, ("#ffe3f2", 110), ("#ffc6e6", 120), specks=("#ffffff", 90, 3))
    tile("weather-psychicterrain.png", W, H, ("#e6d6ff", 90), ("#b48cff", 120), specks=("#ffffff", 80, 2))
    tile("weather-trickroom.png", W, H, ("#ffd0ec", 80), ("#d0679f", 90))
    tile("weather-wonderroom.png", W, H, ("#e6d6ff", 80), ("#8b5cf6", 90))
    tile("weather-magicroom.png", W, H, ("#e4f2ff", 80), ("#5a97ec", 90))
    tile("weather-gravity.png", W, H, ("#2a2440", 60), ("#1f2d44", 120))

def draw_field():
    # The scene shows a 640x360 window of a 700x500 backdrop placed at (-50, -90) (client battle.css .backdrop).
    W, H, OX, OY = 700, 500, 50, 90
    im = Image.new("RGB", (W, H)); px = im.load()
    sky_a, sky_b, gr_a, gr_b = hexc("#bfddf7"), hexc("#e9f3fc"), hexc("#cfe8c0"), hexc("#b7dca2")
    hor = OY + 150
    for y in range(H):
        if y < hor: t = y / hor; a, b = sky_a, sky_b
        else: t = (y - hor) / (H - hor); a, b = gr_a, gr_b
        c = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
        for x in range(W): px[x, y] = c
    d = ImageDraw.Draw(im)
    random.seed(3)
    for _ in range(6):  # soft clouds
        x, y = random.randrange(W), random.randrange(OY, hor - 50)
        for k in range(4): d.ellipse([x + k * 22 - 30, y - 12, x + k * 22 + 20, y + 14], fill=(250, 252, 255))
    for (cx, cy, rx, ry) in [(OX + 470, OY + 186, 120, 26), (OX + 190, OY + 300, 160, 34)]:  # platforms under the two sprites
        d.ellipse([cx - rx, cy - ry + 6, cx + rx, cy + ry + 6], fill=hexc("#86b86e")[:3])
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=hexc("#9ccb83")[:3])
    for _ in range(220):  # grass ticks
        x, y = random.randrange(W), random.randrange(hor + 4, H)
        d.line([(x, y), (x + 1, y - 4)], fill=hexc("#86b86e")[:3])
    os.makedirs(os.path.join(OUT, "fx"), exist_ok=True)
    im.save(os.path.join(OUT, "fx", "bg-field.png"))
    im.save(os.path.join(OUT, "fx", "bg-beach.png"))  # the stylesheet's fallback name

def draw_decoy():
    # The decoy (our name for the substitute mechanic): a stitched cloth dummy on a post, front and back views.
    for sub, back in (("ani", False), ("ani-back", True)):
        frames = []
        for i in range(2):
            im = canvas(96, 96); d = ImageDraw.Draw(im); W = 96 * SS; dy = (i * 2) * SS
            d.rectangle([W * .47, W * .55 + dy, W * .53, W * .92], fill=hexc("#8a6a3c"))
            d.ellipse([W * .30, W * .18 + dy, W * .70, W * .58 + dy], fill=hexc("#e9d9b8"), outline=hexc("#6b5532"), width=2 * SS)
            d.line([(W * .5, W * .2 + dy), (W * .5, W * .56 + dy)], fill=hexc("#6b5532"), width=SS)
            if not back:
                for x in (.42, .58):
                    d.line([(W * (x - .03), W * .33 + dy), (W * (x + .03), W * .39 + dy)], fill=hexc("#1f2d44"), width=2 * SS)
                    d.line([(W * (x + .03), W * .33 + dy), (W * (x - .03), W * .39 + dy)], fill=hexc("#1f2d44"), width=2 * SS)
            d.line([(W * .2, W * .62 + dy), (W * .8, W * .62 + dy)], fill=hexc("#8a6a3c"), width=3 * SS)
            f = im.resize((96, 96), Image.LANCZOS)
            alpha = f.getchannel("A").point(lambda a: 255 if a >= 128 else 0)
            p = f.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=255)
            p.paste(255, alpha.point(lambda a: 255 - a)); p.info["transparency"] = 255
            frames.append(p)
        out = os.path.join(OUT, "sprites", sub); os.makedirs(out, exist_ok=True)
        frames[0].save(os.path.join(out, "substitute.gif"), save_all=True, append_images=frames[1:], duration=400, loop=0, transparency=255, disposal=2)
    # item / mail reveal marks
    for n, c in (("item", "#f0a800"), ("mail", "#5a97ec")):
        im = canvas(24, 24); d = ImageDraw.Draw(im); W = 24 * SS
        d.rounded_rectangle([W * .15, W * .25, W * .85, W * .85], radius=3 * SS, fill=hexc(c), outline=hexc("#1f2d44"), width=SS)
        d.line([(W * .15, W * .45), (W * .85, W * .45)], fill=hexc("#1f2d44"), width=SS)
        im.resize((24, 24), Image.LANCZOS).save(os.path.join(OUT, "fx", n + ".png"))

def draw_page_bg():
    W, H = 1600, 1000
    im = Image.new("RGB", (W, H)); px = im.load()
    a, b = hexc("#e9f3fc"), hexc("#cfe0f2")
    for y in range(H):
        t = y / (H - 1); c = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
        for x in range(W): px[x, y] = c
    d = ImageDraw.Draw(im)
    for x in range(0, W, 40): d.line([(x, 0), (x, H)], fill=(214, 228, 243))
    for y in range(0, H, 40): d.line([(0, y), (W, y)], fill=(214, 228, 243))
    im.save(os.path.join(OUT, "fx", "client-bg-field.jpg"), quality=85)

def draw_misc():
    for g, c in [("m", "#2f6fd0"), ("f", "#d0679f"), ("n", "#5f6f87")]:
        for w, h, pre in [(7, 10, "gender-"), (18, 18, "gender-big-")]:
            im = canvas(w, h); d = ImageDraw.Draw(im); W, H = w * SS, h * SS
            d.ellipse([W * .1, H * .3, W * .9, H * .9], outline=hexc(c), width=max(1, int(W * .16)))
            done(im, w, h, f"{pre}{g}.png")
    os.makedirs(os.path.join(OUT, "img"), exist_ok=True)
    for n, fill, alpha in [("capsule", "#2f6fd0", 255), ("capsule-statused", "#f0a800", 255), ("capsule-fainted", "#5f6f87", 110), ("capsule-none", "#b7c4d6", 255)]:
        im = canvas(40, 30); d = ImageDraw.Draw(im); W, H = 40 * SS, 30 * SS
        pts = [(W * .5, H * .12), (W * .72, H * .3), (W * .72, H * .7), (W * .5, H * .88), (W * .28, H * .7), (W * .28, H * .3)]
        d.polygon(pts, fill=hexc(fill, alpha), outline=hexc("#1f2d44", alpha))
        d.line([(W * .28, H * .5), (W * .72, H * .5)], fill=hexc("#ffffff", min(alpha, 200)), width=SS)
        im.resize((40, 30), Image.LANCZOS).save(os.path.join(OUT, "img", n + ".png"))
    # the approved brand mark + horizontal lockup (projects/duel-exchange/brand/final), used by the top bar and favicon
    brand = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "brand", "final")
    for n, src in [("logo.svg", "logo-mark.svg"), ("lockup.svg", "lockup.svg")]:
        shutil.copyfile(os.path.join(brand, src), os.path.join(OUT, "img", n))
    with open(os.path.join(OUT, "img", "avatar.svg"), "w") as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80" shape-rendering="crispEdges">'
                '<rect x="28" y="10" width="24" height="22" fill="#f2d2b0"/><rect x="26" y="6" width="28" height="8" fill="#2f6fd0"/>'
                '<rect x="24" y="12" width="32" height="4" fill="#2357ad"/><rect x="33" y="20" width="4" height="4" fill="#1f2d44"/>'
                '<rect x="43" y="20" width="4" height="4" fill="#1f2d44"/><rect x="22" y="32" width="36" height="26" fill="#2f6fd0"/>'
                '<rect x="38" y="32" width="4" height="26" fill="#e9f3fc"/><rect x="26" y="58" width="12" height="16" fill="#1f2d44"/>'
                '<rect x="42" y="58" width="12" height="16" fill="#1f2d44"/><rect x="16" y="34" width="6" height="20" fill="#f2d2b0"/>'
                '<rect x="58" y="34" width="6" height="20" fill="#f2d2b0"/></svg>')

def strip_to_gif(src, dst, flip=False):
    im = Image.open(src).convert("RGBA"); fw = im.height; n = im.width // fw
    frames = []
    for i in range(n):
        f = im.crop((i * fw, 0, (i + 1) * fw, fw))
        if flip: f = f.transpose(Image.FLIP_LEFT_RIGHT)
        # GIF: 1-bit alpha on a key colour
        alpha = f.getchannel("A").point(lambda a: 255 if a >= 128 else 0)
        p = f.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=255)
        p.paste(255, alpha.point(lambda a: 255 - a))
        p.info["transparency"] = 255
        frames.append(p)
    frames[0].save(dst, save_all=True, append_images=frames[1:], duration=180, loop=0, transparency=255, disposal=2)

def draw_sprites():
    out = os.path.join(OUT, "sprites")
    for cid in sorted(os.listdir(SPRITES_IN)):
        s = os.path.join(SPRITES_IN, cid)
        if not os.path.isdir(s): continue
        os.makedirs(os.path.join(out, cid), exist_ok=True)
        for v in ("front", "back", "front-shiny", "back-shiny"):
            if os.path.exists(os.path.join(s, v + ".png")): strip_to_gif(os.path.join(s, v + ".png"), os.path.join(out, cid, v + ".gif"))
        shutil.copy(os.path.join(s, "icon.png"), os.path.join(out, cid, "icon.png"))
        # first frame as a still for the teambuilder
        im = Image.open(os.path.join(s, "front.png")); im.crop((0, 0, im.height, im.height)).save(os.path.join(out, cid, "still.png"))

TYPE_COLOURS = {"Normal": "#9a9a7a", "Fire": "#e8501e", "Water": "#3b8fe0", "Electric": "#e0b400", "Grass": "#4caf3c",
    "Ice": "#4fb6d8", "Fighting": "#b8382c", "Poison": "#9a4fb8", "Ground": "#c49a4a", "Flying": "#8a9ef0",
    "Psychic": "#e8507e", "Bug": "#8aa21c", "Rock": "#a8903c", "Ghost": "#6a5498", "Dragon": "#6a3cf0", "Dark": "#5a4a3c",
    "Steel": "#8a96aa", "Fairy": "#e08ac4", "???": "#6a8a8a"}

def badge(path, w, h, label, fill, ink="#ffffff", size=8):
    from PIL import ImageFont
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf", size * SS)
    im = canvas(w, h); d = ImageDraw.Draw(im); W, H = w * SS, h * SS
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=3 * SS, fill=hexc(fill), outline=hexc("#1f2d44", 90), width=SS)
    tw = d.textlength(label, font=font)
    d.text(((W - tw) / 2, H / 2), label, font=font, fill=hexc(ink), anchor="lm")
    im = im.resize((w, h), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True); im.save(path)

def draw_badges():
    for t, c in TYPE_COLOURS.items():
        label = t.upper() if len(t) <= 6 else t[:5].upper()
        badge(os.path.join(OUT, "sprites", "types", t + ".png"), 32, 14, label, c, size=7)
    for c, label, fill in [("Physical", "PHYS", "#e5483b"), ("Special", "SPEC", "#2f6fd0"), ("Status", "STAT", "#5f6f87"), ("undefined", "?", "#b7c4d6")]:
        badge(os.path.join(OUT, "sprites", "categories", c + ".png"), 32, 14, label, fill, size=7)
    misc = os.path.join(OUT, "sprites", "misc"); os.makedirs(misc, exist_ok=True)
    for g in ("m", "f", "n"): shutil.copy(os.path.join(OUT, "fx", f"gender-big-{g}.png"), os.path.join(misc, f"gender-{g}.png"))
    im = canvas(22, 22); d = ImageDraw.Draw(im); W = 22 * SS
    d.polygon([(x * W, y * W) for x, y in star(4, .46, .12)], fill=hexc("#f0a800"))
    im.resize((22, 22), Image.LANCZOS).save(os.path.join(misc, "shiny.png"))

if __name__ == "__main__":
    draw_effects(); draw_weather(); draw_field(); draw_decoy(); draw_page_bg(); draw_misc(); draw_badges(); draw_sprites()
    print("art written to", os.path.normpath(OUT))
