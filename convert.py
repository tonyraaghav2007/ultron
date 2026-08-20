from PIL import Image

# Path to the input image and output icon
img_path = r"C:\Users\legion-5pro\.gemini\antigravity-ide\brain\577fbc56-9c6e-4783-aca4-694fe75a5511\ultron_logo_1786876251114.jpg"
ico_path = r"C:\Users\legion-5pro\Documents\Ultron Main\ultron_logo.ico"

# Open the image, resize to square if needed, and save as .ico
img = Image.open(img_path)
img = img.resize((256, 256))
img.save(ico_path, format="ICO", sizes=[(256, 256)])
print(f"Successfully converted to {ico_path}")
