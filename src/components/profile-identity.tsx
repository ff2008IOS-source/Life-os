"use client";
import Image from "next/image";
import { useState } from "react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
export function AppLogo() {
  return (
    <svg
      viewBox="0 0 32 32"
      width="24"
      height="24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 5v20h17"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="11" r="6" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="m18 11 2 2 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function ProfileAvatar() {
  const { data } = useWorkspace();
  return (
    <span className="avatar">
      {data.profile.avatar_data_url ? (
        <Image
          src={data.profile.avatar_data_url}
          alt="Your profile picture"
          width={40}
          height={40}
          unoptimized
        />
      ) : (
        data.profile.display_name
          ?.split(/\s+/)
          .slice(0, 2)
          .map((x) => x[0])
          .join("")
          .toUpperCase() || "ME"
      )}
    </span>
  );
}
export function ProfilePictureSettings() {
  const { data, request, refresh, notify } = useWorkspace();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(value: string | null) {
    await request("/api/v1/profile", {
      method: "PATCH",
      body: JSON.stringify({
        version: data.profile.version,
        data: {
          display_name: data.profile.display_name,
          theme: data.profile.theme,
          density: data.profile.density,
          avatar_data_url: value,
        },
      }),
    });
    await refresh();
    notify(value ? "Profile picture saved" : "Profile picture removed");
  }
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 8 * 1024 * 1024
      )
        throw Error("Choose a JPEG, PNG or WebP image smaller than 8 MB.");
      const image = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 192;
        canvas.height = 192;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw Error("Image resizing is unavailable in this browser.");
        const side = Math.min(image.width, image.height);
        ctx.drawImage(
          image,
          (image.width - side) / 2,
          (image.height - side) / 2,
          side,
          side,
          0,
          0,
          192,
          192,
        );
        await save(canvas.toDataURL("image/jpeg", 0.8));
      } finally {
        image.close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Picture could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel">
      <h2>Your profile picture</h2>
      <p className="small muted">
        Resized on your device and stored privately with your profile. Nothing
        is uploaded until you choose an image.
      </p>
      <div className="briefing-actions">
        <ProfileAvatar />
        <label>
          Choose profile picture
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </label>
        {data.profile.avatar_data_url && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await save(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Removal failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove picture
          </Button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
