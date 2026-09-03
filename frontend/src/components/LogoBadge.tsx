import { useState } from "react";

interface Props {
  logo: string;
  logoUrl?: string;
  color: string;
  className: string;
  loading?: "eager" | "lazy";
}

export default function LogoBadge({ logo, logoUrl, color, className, loading = "eager" }: Props) {
  const [showImage, setShowImage] = useState(Boolean(logoUrl));
  const imageVisible = Boolean(logoUrl) && showImage;

  return (
    <div
      className={`${className} flex items-center justify-center font-mono font-medium shrink-0 ${imageVisible ? "bg-transparent border-0" : ""}`}
      style={imageVisible ? undefined : { background: `${color}18`, border: `1px solid ${color}40`, color }}
    >
      {imageVisible ? (
        <img src={logoUrl} alt="" loading={loading} className="max-w-[82%] max-h-[82%] object-contain" onError={() => setShowImage(false)} />
      ) : logo}
    </div>
  );
}
