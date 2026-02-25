# Gunakan image Node.js versi LTS yang ringan (Alpine Linux)
FROM node:18-alpine

# Set direktori kerja di dalam container
WORKDIR /app

# Copy file dependensi terlebih dahulu untuk memanfaatkan cache layer Docker
COPY package*.json ./

# Install dependensi (hanya production dependencies jika memungkinkan)
RUN npm install --production

# Copy seluruh source code ke dalam container
COPY . .

# Ekspos port yang digunakan oleh aplikasi (sesuai index.js: 3000)
EXPOSE 3000

# Jalankan aplikasi
CMD ["node", "index.js"]