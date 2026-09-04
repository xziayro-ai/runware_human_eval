import "./globals.css";
import VoterBadge from "./VoterBadge";

export const metadata = {
  title: "Human Eval",
  description: "Vote for human preferences between experiments",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/runware-icon.svg"
              alt=""
              width={22}
              height={22}
              className="brand-icon"
            />
            Human Eval
          </a>
          <VoterBadge />
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
