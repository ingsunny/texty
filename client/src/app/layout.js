import "./globals.css";
import { AuthProvider } from "./context/AuthContext";

export const metadata = {
  title: "Chat App",
  description: "My awesome chat app",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white h-screen">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
