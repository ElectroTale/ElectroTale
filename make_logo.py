from PIL import Image, ImageDraw, ImageFont, ImageFilter
S=1024; r=330; cx,cy=S/2,S/2+20
def P(x,y): return (cx+x*r, cy+y*r)
H=[P(0,-1),P(.866,-.5),P(.866,.5),P(0,1),P(-.866,.5),P(-.866,-.5)]
T0,T1,T2=P(0,-.5),P(.52,.36),P(-.52,.36)
im=Image.new("RGBA",(S,S),(0,0,0,0))
bg=Image.new("RGBA",(S,S),(0,0,0,0)); d=ImageDraw.Draw(bg)
d.rounded_rectangle([24,24,S-24,S-24],radius=200,fill=(26,22,17,255))
glow=Image.new("RGBA",(S,S),(0,0,0,0)); g=ImageDraw.Draw(glow)
for i in range(60,0,-1):
    rr=r+40+i*5; g.ellipse([cx-rr,cy-rr,cx+rr,cy+rr],fill=(230,170,60,int(12*(60-i)/60)))
glow=glow.filter(ImageFilter.GaussianBlur(30))
mask=Image.new("L",(S,S),0); ImageDraw.Draw(mask).rounded_rectangle([24,24,S-24,S-24],radius=200,fill=255)
bg.alpha_composite(Image.composite(glow,Image.new("RGBA",(S,S),(0,0,0,0)),mask))
ImageDraw.Draw(bg).rounded_rectangle([24,24,S-24,S-24],radius=200,outline=(201,151,63,255),width=10)
im.alpha_composite(bg)
sh=Image.new("RGBA",(S,S),(0,0,0,0)); ImageDraw.Draw(sh).polygon([(x+14,y+22) for x,y in H],fill=(0,0,0,150))
im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
d=ImageDraw.Draw(im)
faces=[([H[5],H[0],T0],(250,214,120)),([H[0],H[1],T0],(236,190,92)),([H[1],T0,T1],(214,160,64)),([H[1],H[2],T1],(176,124,40)),
 ([H[2],H[3],T1],(150,102,30)),([H[3],T1,T2],(190,138,50)),([H[3],H[4],T2],(140,95,28)),([H[4],H[5],T2],(168,118,38)),
 ([H[5],T0,T2],(228,182,86)),([T0,T1,T2],(255,226,140))]
for poly,col in faces: d.polygon(poly,fill=col+(255,))
edge=(110,72,18,255)
for i in range(6): d.line([H[i],H[(i+1)%6]],fill=edge,width=12)
for a,b in [(H[0],T0),(H[1],T0),(H[1],T1),(H[2],T1),(H[3],T1),(H[3],T2),(H[4],T2),(H[5],T2),(H[5],T0),(T0,T1),(T1,T2),(T2,T0)]:
    d.line([a,b],fill=edge,width=8)
hl=Image.new("RGBA",(S,S),(0,0,0,0)); ImageDraw.Draw(hl).polygon([H[5],H[0],T0],fill=(255,255,255,70)); im.alpha_composite(hl)
f=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",150)
tx,ty=cx,cy+r*0.08
d.text((tx+4,ty+5),"20",font=f,fill=(255,240,190,120),anchor="mm")
d.text((tx,ty),"20",font=f,fill=(74,46,10,255),anchor="mm")
im.save("logo-1024.png")
im.resize((512,512),Image.LANCZOS).save("app/icon.png")
im.resize((256,256),Image.LANCZOS).save("icon.ico",sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(24,24),(16,16)])
im.resize((256,256),Image.LANCZOS).save("/tmp/claude-0/-home-claude/247c74ea-bb53-5308-a318-9610c115f010/scratchpad/logo256.png")
