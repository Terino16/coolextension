const fs = require('fs');
const path = require('path');

// Create SVG icons with different sizes
const sizes = [16, 48, 128];

// Simple SVG template for a Twitter-like icon
function generateSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#1DA1F2"/>
  <circle cx="${size/2}" cy="${size/2}" r="${size/3}" fill="white"/>
  <path d="M${size/2 - size/6},${size/2 - size/10} L${size/2 + size/6},${size/2 - size/10} M${size/2 - size/6},${size/2} L${size/2 + size/6},${size/2} M${size/2 - size/6},${size/2 + size/10} L${size/2 + size/6},${size/2 + size/10}" stroke="white" stroke-width="${size/20}" stroke-linecap="round"/>
</svg>`;
}

// Function to convert SVG to PNG (this is a placeholder - in a real scenario, you'd use a library like sharp)
function svgToPng(svgContent, size) {
  // In a real implementation, you would convert SVG to PNG
  // For this example, we'll just write the SVG content to a file with a .png extension
  return svgContent;
}

// Create the images directory if it doesn't exist
const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir);
}

// Generate icons for each size
sizes.forEach(size => {
  const svgContent = generateSvg(size);
  const pngContent = svgToPng(svgContent, size);
  
  // Write SVG file
  fs.writeFileSync(path.join(imagesDir, `icon${size}.svg`), svgContent);
  
  // Write PNG file (in a real scenario)
  // For this example, we'll just write the SVG content to a file with a .png extension
  fs.writeFileSync(path.join(imagesDir, `icon${size}.png`), pngContent);
  
  console.log(`Generated icon${size}.svg and icon${size}.png`);
});

console.log('Icon generation complete!'); 