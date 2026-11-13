import { useEffect, useRef, useState } from "react";
import { getSetting, setSetting } from "../db";

export function PreferencesPage() {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    getSetting("preferences", "").then((value) => {
      setText(value);
      setLoaded(true);
    });
  }, []);

  function change(value: string) {
    setText(value);
    setSaved(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      await setSetting("preferences", value);
      setSaved(true);
    }, 500);
  }

  return (
    <>
      <h1>Предпочитания</h1>
      <p className="muted">
        Напиши какво обичаш, какво не обичаш и към какво имаш алергии. Асистентът го взима предвид при офертите и
        рецептите.
      </p>
      <textarea
        className="prefs"
        rows={10}
        value={text}
        disabled={!loaded}
        onChange={(e) => change(e.target.value)}
        placeholder={"Например:\nАлергия към ядки.\nНе обичам риба и гъби.\nОбичам пилешко, сирене и люто."}
      />
      <p className="muted small">{saved ? "✓ Запазено" : "Запазва се автоматично на това устройство."}</p>
    </>
  );
}
