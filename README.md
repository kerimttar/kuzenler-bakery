# Kuzenler Bakery — Full-Stack Ordering & Bakery Management System

A full-stack web application built for **Kuzenler Ekmek Fırını** (Çavuşlu, Giresun), enabling customers to place online piece or tray orders and allowing bakery management to handle daily operations from a single dashboard.

## Features
- **Customer Storefront:** Browse categorized products, filter tray-eligible items, manage shopping cart quantities, and place guest or registered orders.
- **Live Order Tracking & Cancellation:** Track real-time preparation stages (`Pending` → `Baking` → `Out for Delivery` → `Delivered`) via `FRN-XXXX` tracking codes or phone number, and cancel orders prior to preparation.
- **Customer Authentication & Recovery:** JWT-based registration/login, personal order history, and 6-digit email verification code password reset.
- **Admin Dashboard:** Daily and total revenue analytics, best-selling product tracking, live *"Fresh Out of the Oven"* badge toggles, product CRUD with image uploads, order stage management, and a rate-limited recovery key mechanism.
- **Security:** `scrypt` password hashing, JWT role-based access control (`admin` / `customer`), server-side price validation against cart tampering, parameterized SQL queries, XSS sanitization, and IP rate limiting.

## Tech Stack
- **Backend:** Node.js, Express.js, JWT, Multer, Nodemailer
- **Database:** PostgreSQL (Neon.tech)
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Deployment:** Render.com

## Local Setup
1. Clone the repository and install dependencies:
   npm install

2. Create a .env file in the root directory:
   DATABASE_URL=your_postgresql_connection_string
   JWT_SECRET=your_jwt_secret
   ADMIN_PASSWORD=your_admin_password
   ADMIN_RECOVERY_KEY=your_recovery_key

3. Run the SQL schema and start the server:
   npm start