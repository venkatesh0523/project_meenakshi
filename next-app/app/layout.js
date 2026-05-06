import "./globals.css";
import ThemeToggle from "./ThemeToggle";

export const metadata = {
  title: "Farm LED Control",
  description: "Next.js dashboard for LED control with C++ API and PostgreSQL"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
