// Unity Sprite Sheet, PNG Frame Sequence, WAV Audio & C# Script Exporter for Keyboard Sticker Animations
import { encodeWav } from '../util.js';
import { SR } from '../audio/engine.js';
import {
  FINGERS,
  getFlatKeys,
  normalizeKeyboardOpts,
  keyExportSlug,
  unityKeySizeId,
} from './model.js';
import { createKeyboardScene } from './renderer.js';

// Precomputed CRC32 table for standard ZIP archives
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a standard uncompressed .zip Blob from an array of { path, data (Uint8Array | string | Blob) }.
 */
export async function buildZipBlob(entries) {
  const encoder = new TextEncoder();
  const prepared = [];
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path.replace(/^\/+/, ''));
    let dataBytes;
    if (typeof entry.data === 'string') {
      dataBytes = encoder.encode(entry.data);
    } else if (entry.data instanceof Uint8Array) {
      dataBytes = entry.data;
    } else if (entry.data instanceof ArrayBuffer) {
      dataBytes = new Uint8Array(entry.data);
    } else if (entry.data instanceof Blob) {
      dataBytes = new Uint8Array(await entry.data.arrayBuffer());
    } else {
      dataBytes = new Uint8Array(0);
    }
    prepared.push({
      nameBytes,
      dataBytes,
      crc: crc32(dataBytes),
    });
  }

  let localSize = 0;
  let centralSize = 0;
  for (const item of prepared) {
    localSize += 30 + item.nameBytes.length + item.dataBytes.length;
    centralSize += 46 + item.nameBytes.length;
  }

  const totalSize = localSize + centralSize + 22;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  let localOffset = 0;
  const localOffsets = [];

  for (const item of prepared) {
    localOffsets.push(localOffset);
    view.setUint32(localOffset, 0x04034b50, true); // Local file header signature
    view.setUint16(localOffset + 4, 20, true);     // Version needed to extract (2.0)
    view.setUint16(localOffset + 6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(localOffset + 8, 0, true);      // Compression method: 0 (Store)
    view.setUint16(localOffset + 10, 0, true);     // Mod time
    view.setUint16(localOffset + 12, 0x5421, true);// Mod date
    view.setUint32(localOffset + 14, item.crc, true);
    view.setUint32(localOffset + 18, item.dataBytes.length, true);
    view.setUint32(localOffset + 22, item.dataBytes.length, true);
    view.setUint16(localOffset + 26, item.nameBytes.length, true);
    view.setUint16(localOffset + 28, 0, true);
    out.set(item.nameBytes, localOffset + 30);
    out.set(item.dataBytes, localOffset + 30 + item.nameBytes.length);
    localOffset += 30 + item.nameBytes.length + item.dataBytes.length;
  }

  let centralOffset = localOffset;
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    view.setUint32(centralOffset, 0x02014b50, true); // Central directory signature
    view.setUint16(centralOffset + 4, 20, true);     // Version made by
    view.setUint16(centralOffset + 6, 20, true);     // Version needed
    view.setUint16(centralOffset + 8, 0x0800, true); // UTF-8 flag
    view.setUint16(centralOffset + 10, 0, true);    // Compression method: 0 (Store)
    view.setUint16(centralOffset + 12, 0, true);
    view.setUint16(centralOffset + 14, 0x5421, true);
    view.setUint32(centralOffset + 16, item.crc, true);
    view.setUint32(centralOffset + 20, item.dataBytes.length, true);
    view.setUint32(centralOffset + 24, item.dataBytes.length, true);
    view.setUint16(centralOffset + 28, item.nameBytes.length, true);
    view.setUint16(centralOffset + 30, 0, true);
    view.setUint16(centralOffset + 32, 0, true);
    view.setUint16(centralOffset + 34, 0, true);
    view.setUint16(centralOffset + 36, 0, true);
    view.setUint32(centralOffset + 38, 0, true);
    view.setUint32(centralOffset + 42, localOffsets[i], true);
    out.set(item.nameBytes, centralOffset + 46);
    centralOffset += 46 + item.nameBytes.length;
  }

  // End of central directory record
  view.setUint32(centralOffset, 0x06054b50, true);
  view.setUint16(centralOffset + 4, 0, true);
  view.setUint16(centralOffset + 6, 0, true);
  view.setUint16(centralOffset + 8, prepared.length, true);
  view.setUint16(centralOffset + 10, prepared.length, true);
  view.setUint32(centralOffset + 12, centralSize, true);
  view.setUint32(centralOffset + 16, localSize, true);
  view.setUint16(centralOffset + 20, 0, true);

  return new Blob([out], { type: 'application/zip' });
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG-codering mislukt'))), 'image/png');
  });
}

/**
 * Compute the start and end time window for a Unity sprite animation.
 */
export function computeUnityTimeWindow(schedule, { contentMode = 'sticker_only', trimStillDelays = true, fps = 30 } = {}) {
  if (!trimStillDelays) {
    return { tStart: 0, tEnd: schedule.total };
  }
  const frameStep = 1 / Math.max(1, fps);
  const burstEnd = schedule.peelEnd - 0.02 + 0.52;
  // Preserve the completion chime as well as the last visible effect.
  const soundEnd = schedule.pressPeak + 0.015 + 0.52;
  const activeEnd = Math.min(schedule.total, Math.max(schedule.shineEnd, schedule.pressDone, burstEnd, soundEnd) + frameStep * 2);

  if (contentMode === 'sticker_only') {
    // Start right as the sticker begins peeling/popping/sliding onto the key
    const activeStart = Math.max(0, schedule.peelStart);
    return { tStart: activeStart, tEnd: Math.max(activeStart + 0.35, activeEnd) };
  }
  // For key_and_sticker or full_board, include focus-in through end of active animation
  const activeStart = Math.max(0, schedule.focusStart);
  return { tStart: activeStart, tEnd: Math.max(activeStart + 0.4, Math.min(schedule.total, schedule.animEnd)) };
}

// Both export and its preview use this clock. Never stretch samples across the
// clip: Unity plays each frame for exactly 1 / fps seconds.
export function unityClipTiming(schedule, config = {}) {
  const fps = [24, 30, 60].includes(config.fps) ? config.fps : 30;
  const { tStart, tEnd } = computeUnityTimeWindow(schedule, { ...config, fps });
  const frameCount = Math.max(2, Math.ceil((tEnd - tStart) * fps) + 1);
  return { tStart, tEnd, fps, frameCount, duration: frameCount / fps };
}

export function unityFrameTime(timing, index) {
  return Math.min(timing.tEnd, timing.tStart + index / timing.fps);
}

export function sliceUnityAudio(soundtrack, timing) {
  const pcm = new Float32Array(Math.ceil(timing.duration * SR));
  const start = Math.max(0, Math.round(timing.tStart * SR));
  const end = Math.min(soundtrack.length, Math.round(timing.tEnd * SR), start + pcm.length);
  pcm.set(soundtrack.subarray(start, Math.max(start, end)));
  return pcm;
}

export function unityFrameSize(spriteBox, contentMode, baseCellSize = 256) {
  const scale = contentMode === 'full_board' ? baseCellSize / 512 : baseCellSize / 256;
  return {
    cellWidth: Math.ceil((contentMode === 'full_board' ? 1920 : spriteBox.logicalW) * scale),
    cellHeight: Math.ceil((contentMode === 'full_board' ? 1080 : spriteBox.logicalH) * scale),
    keyPixelWidth: spriteBox.keyW * scale,
    keyPixelHeight: spriteBox.keyH * scale,
  };
}

/**
 * Generate a ready-to-use Unity C# MonoBehaviour script for playing the exported Sprite Sheet or Frame Sequence.
 */
export function generateUnityCSharpScript(opts, metaList) {
  const fc = opts.fingerColors || {};
  const firstMeta = metaList[0] || { fps: 30, frameCount: 36, cellWidth: 256, cellHeight: 256 };
  return `using System.Collections;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Speelt de geëxporteerde Toetsenbord Sticker-afplakanimatie (Sprite Sheet / PNG-frames) af in Unity.
/// Werkt met zowel Unity UI (Image) als 2D/3D (SpriteRenderer) + optionele AudioSource.
///
/// Gebruik in Unity:
/// 1. Zet de geëxporteerde Sprite Sheet PNG in Unity op:
///    - Texture Type: Sprite (2D and UI)
///    - Sprite Mode: Multiple
///    - Klik op 'Sprite Editor' -> Slice -> Type: Grid By Cell Size
///    - Pixel Size: X = ${firstMeta.cellWidth}, Y = ${firstMeta.cellHeight} | Pivot: Center (0.5, 0.5) -> Slice -> Apply.
/// 2. Sleep alle geslicete sub-sprites (of losse frame_000..png bestanden) in de 'frames' lijst van dit script.
/// 3. Roep PlaySticker() of PlayStickerWithFingerColor("index") aan!
/// </summary>
public class StickerSpriteAnimator : MonoBehaviour
{
    [Header("Sprite Frames (geslicete Sprite Sheet of losse PNG-frames)")]
    public Sprite[] frames;

    [Header("Afspeel-instellingen")]
    public float fps = ${firstMeta.fps}f;
    public bool playOnEnable = false;
    public bool keepFinalFrameVisible = true;

    [Tooltip("Exact aantal frames uit unity_import_meta.json; lege gridcellen overslaan")]
    public int frameCount = ${firstMeta.frameCount};

    [Header("Optionele Componenten (automatisch gevonden indien leeg)")]
    public Image uiImage;
    public SpriteRenderer spriteRenderer;
    public AudioSource audioSource;
    public AudioClip stickerSfx;

    [Header("Referentie Vingerkleuren (voor Witte Master-Sprite tinting)")]
    public Color pinkyColor      = HexToColor("${fc.pinky || '#745c39'}"); // Pink
    public Color ringColor       = HexToColor("${fc.ring || '#506b43'}"); // Ringvinger
    public Color middleColor     = HexToColor("${fc.middle || '#693d44'}"); // Middelvinger
    public Color indexLeftColor  = HexToColor("${fc.index || '#456d74'}"); // Wijsvinger Links
    public Color indexRightColor = HexToColor("${fc.index_right || '#375169'}"); // Wijsvinger Rechts
    public Color thumbColor      = HexToColor("${fc.thumb || '#725575'}"); // Duim (Spatie)

    private Coroutine _playRoutine;

    private void Awake()
    {
        if (uiImage == null) uiImage = GetComponent<Image>();
        if (spriteRenderer == null) spriteRenderer = GetComponent<SpriteRenderer>();
        if (audioSource == null) audioSource = GetComponent<AudioSource>();
    }

    private void OnEnable()
    {
        if (playOnEnable) PlaySticker();
    }

    private void OnDisable()
    {
        if (_playRoutine != null) StopCoroutine(_playRoutine);
        _playRoutine = null;
    }

    /// <summary>
    /// Speel de sticker-afplakanimatie af op deze toets.
    /// </summary>
    public void PlaySticker()
    {
        if (frames == null || frames.Length == 0) return;
        if (_playRoutine != null) StopCoroutine(_playRoutine);
        _playRoutine = StartCoroutine(CoPlay());
    }

    /// <summary>
    /// Kleur een Witte Master-Sprite met een van de 6 vingerkleuren ("pinky", "ring", "middle", "index", "index_right", "thumb") en speel af.
    /// </summary>
    public void PlayStickerWithFingerColor(string fingerId)
    {
        SetTint(GetFingerColor(fingerId));
        PlaySticker();
    }

    public Color GetFingerColor(string fingerId)
    {
        switch ((fingerId ?? "").ToLowerInvariant())
        {
            case "pinky":       return pinkyColor;
            case "ring":        return ringColor;
            case "middle":      return middleColor;
            case "index":       return indexLeftColor;
            case "index_right": return indexRightColor;
            case "thumb":       return thumbColor;
            default:            return indexLeftColor;
        }
    }

    public void SetTint(Color color)
    {
        if (uiImage != null) uiImage.color = color;
        if (spriteRenderer != null) spriteRenderer.color = color;
    }

    private IEnumerator CoPlay()
    {
        SetVisible(true);
        if (audioSource != null && stickerSfx != null)
        {
            audioSource.PlayOneShot(stickerSfx);
        }

        int count = frameCount > 0 ? Mathf.Min(frameCount, frames.Length) : frames.Length;
        float startedAt = Time.time;
        float rate = Mathf.Max(1f, fps);
        while (Time.time - startedAt < count / rate)
        {
            int index = Mathf.Min(count - 1, Mathf.FloorToInt((Time.time - startedAt) * rate));
            SetSprite(frames[index]);
            yield return null;
        }
        SetSprite(frames[count - 1]);

        if (!keepFinalFrameVisible)
        {
            SetVisible(false);
        }
        _playRoutine = null;
    }

    private void SetSprite(Sprite s)
    {
        if (uiImage != null) uiImage.sprite = s;
        if (spriteRenderer != null) spriteRenderer.sprite = s;
    }

    private void SetVisible(bool visible)
    {
        if (uiImage != null) uiImage.enabled = visible;
        if (spriteRenderer != null) spriteRenderer.enabled = visible;
    }

    private static Color HexToColor(string hex)
    {
        if (ColorUtility.TryParseHtmlString(hex, out Color c)) return c;
        return Color.white;
    }
}
`;
}

// Explicit slice rectangles avoid Unity's automatic ordering and empty grid
// cells. The importer also writes AnimationClips with the exported FPS.
// Unity Sprite Data Provider API:
// https://docs.unity3d.com/6000.0/Documentation/Manual/sprite/sprite-editor/sprite-editor-data-provider-api.html
export function generateUnityEditorScript(metaList, { wantSpriteSheet = true } = {}) {
  const data = JSON.stringify({ animations: metaList }).replaceAll('"', '""');
  return `using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.U2D.Sprites;
using UnityEngine;
using UnityEngine.UI;

public static class ImportStickerSprites
{
    [Serializable] private class Frame { public string name; public int x, y, width, height; }
    [Serializable] private class Animation {
        public string slug, filename;
        public float fps, keyPixelWidth, widthUnits;
        public int frameCount;
        public Frame[] frames;
    }
    [Serializable] private class Package { public Animation[] animations; }
    private const string Metadata = @"${data}";

    [MenuItem("Tools/Sticker Animaties/Importeer exportpakket")]
    public static void Import()
    {
        string folder = EditorUtility.OpenFolderPanel("Kies de uitgepakte exportmap in Assets", Application.dataPath, "");
        if (string.IsNullOrEmpty(folder)) return;
        string assets = Path.GetFullPath(Application.dataPath).Replace('\\\\', '/').TrimEnd('/');
        folder = Path.GetFullPath(folder).Replace('\\\\', '/').TrimEnd('/');
        if (folder != assets && !folder.StartsWith(assets + "/", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Plaats het exportpakket eerst in de Assets-map.");
        string root = "Assets" + folder.Substring(assets.Length);
        AssetDatabase.Refresh();
        foreach (Animation animation in JsonUtility.FromJson<Package>(Metadata).animations)
        {
            Sprite[] sprites;
            ${wantSpriteSheet ? `string path = root + "/SpriteSheets/" + animation.filename;
            TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer == null) throw new InvalidOperationException("PNG ontbreekt: " + path);
            Configure(importer, animation);
            importer.spriteImportMode = SpriteImportMode.Multiple;
            var factory = new SpriteDataProviderFactories();
            factory.Init();
            var provider = factory.GetSpriteEditorDataProviderFromObject(importer);
            provider.InitSpriteEditorDataProvider();
            var existingIds = provider.GetSpriteRects().ToDictionary(rect => rect.name, rect => rect.spriteID);
            var rects = animation.frames.Select(frame => new SpriteRect {
                name = animation.slug + "_" + frame.name,
                rect = new Rect(frame.x, frame.y, frame.width, frame.height),
                pivot = new Vector2(0.5f, 0.5f), alignment = SpriteAlignment.Center,
                spriteID = existingIds.TryGetValue(animation.slug + "_" + frame.name, out var id) ? id : GUID.Generate()
            }).ToArray();
            provider.SetSpriteRects(rects);
#if UNITY_2021_2_OR_NEWER
            var names = provider.GetDataProvider<ISpriteNameFileIdDataProvider>();
            names.SetNameFileIdPairs(rects.Select(rect => new SpriteNameFileIdPair(rect.name, rect.spriteID)));
#endif
            provider.Apply();
            importer.SaveAndReimport();
            sprites = AssetDatabase.LoadAllAssetsAtPath(path).OfType<Sprite>().OrderBy(s => s.name, StringComparer.Ordinal).ToArray();` : `sprites = animation.frames.Select(frame => {
                string path = root + "/Frames/" + animation.slug + "/" + frame.name + ".png";
                TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
                if (importer == null) throw new InvalidOperationException("PNG ontbreekt: " + path);
                Configure(importer, animation);
                importer.spriteImportMode = SpriteImportMode.Single;
                importer.SaveAndReimport();
                return AssetDatabase.LoadAssetAtPath<Sprite>(path);
            }).ToArray();`}
            WriteClip(root + "/" + animation.slug + "_SpriteRenderer.anim", animation, sprites, typeof(SpriteRenderer));
            WriteClip(root + "/" + animation.slug + "_UI.anim", animation, sprites, typeof(Image));
        }
        AssetDatabase.SaveAssets();
        Debug.Log("Sticker-animaties geïmporteerd met exacte framevolgorde, vormen en FPS.");
    }

    private static void Configure(TextureImporter importer, Animation animation)
    {
        importer.textureType = TextureImporterType.Sprite;
        importer.alphaIsTransparency = true;
        importer.mipmapEnabled = false;
        importer.npotScale = TextureImporterNPOTScale.None;
        importer.maxTextureSize = 16384;
        importer.textureCompression = TextureImporterCompression.Uncompressed;
        importer.spritePixelsPerUnit = animation.keyPixelWidth / Mathf.Max(1f, animation.widthUnits);
        var settings = new TextureImporterSettings();
        importer.ReadTextureSettings(settings);
        settings.spriteMeshType = SpriteMeshType.FullRect;
        importer.SetTextureSettings(settings);
    }

    private static void WriteClip(string path, Animation animation, Sprite[] sprites, Type component)
    {
        AnimationClip clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(path);
        bool create = clip == null;
        if (create) clip = new AnimationClip();
        clip.frameRate = animation.fps;
        var keys = new ObjectReferenceKeyframe[sprites.Length + 1];
        for (int i = 0; i < sprites.Length; i++)
            keys[i] = new ObjectReferenceKeyframe { time = i / animation.fps, value = sprites[i] };
        keys[sprites.Length] = new ObjectReferenceKeyframe { time = sprites.Length / animation.fps, value = sprites[sprites.Length - 1] };
        AnimationUtility.SetObjectReferenceCurve(clip,
            EditorCurveBinding.PPtrCurve("", component, "m_Sprite"), keys);
        if (create) AssetDatabase.CreateAsset(clip, path);
        else EditorUtility.SetDirty(clip);
    }
}
`;
}

export function generateUnityReadme(opts, metaList, config) {
  const lines = [
    '====================================================================',
    '  UNITY STICKER-AFPLAK SPRITE EXPORT — IMPORT HANDLEIDING',
    '====================================================================',
    '',
    'AUTOMATISCH IMPORTEREN (aanbevolen):',
    '   - Vereist het Unity 2D Sprite-pakket (Package Manager).',
    '   - Pak het hele ZIP-pakket uit in een eigen map onder Assets.',
    '   - Wacht tot Unity de Editor/ImportStickerSprites.cs heeft gecompileerd.',
    '   - Kies Tools > Sticker Animaties > Importeer exportpakket en selecteer die map.',
    '   - Je krijgt correct geslicete sprites en .anim clips voor SpriteRenderer en UI Image.',
    '   - Gebruik de bijbehorende WAV voor geluid; de .anim clips bevatten alleen beeld.',
    '',
    `Export-inhoud : ${config.contentMode}`,
    `Variaties     : ${config.targetScope} (${metaList.length} animatie(s))`,
    `Framerate     : ${config.fps} FPS`,
    `Sticker stijl : ${opts.stickerStyle} (Shine: ${opts.stickerShine !== false ? 'Aan' : 'Uit'})`,
    '',
    '1. SPRITE SHEET SLICEN IN UNITY:',
    '   - Sleep de .png Sprite Sheet(s) en sticker_sfx.wav in je Unity Project (Assets).',
    '   - Klik op de Sprite Sheet PNG in Unity en stel in de Inspector in:',
    '       * Texture Type : Sprite (2D and UI)',
    '       * Sprite Mode  : Multiple',
    '       * Alpha Is Transparency : Aan (checked)',
    '   - Klik op [Apply] en open de [Sprite Editor].',
    '   - Kies bovenaan [Slice] -> Type: "Grid By Cell Size":',
  ];

  for (const m of metaList) {
    lines.push(
      `       * ${m.filename || m.slug}: Cell Size X = ${m.cellWidth}, Y = ${m.cellHeight} (${m.columns} kolommen × ${m.rows} rijen, ${m.frameCount} frames, toets = ${m.keyPixelWidth}×${m.keyPixelHeight}px; formaat ${m.sizeId || '1u'})`
    );
  }

  lines.push(
    '       * Pivot: Center (0.5, 0.5)',
    '   - Klik op [Slice] en daarna rechtsboven op [Apply].',
    '   - Lees frames van links naar rechts, daarna de volgende rij van boven naar beneden.',
    '   - Gebruik exact frameCount frames; lege cellen aan het einde horen niet bij de animatie.',
    '   - JSON-framecoördinaten gebruiken de Unity-oorsprong linksonder.',
    '',
    '2. AFSPELEN OP EEN TOETS IN UNITY:',
    '   - Plaats een UI Image of SpriteRenderer precies op het midden van je toets (Pivot 0.5, 0.5).',
    '   - Voeg het meegeleverde script "StickerSpriteAnimator.cs" toe aan het GameObject.',
    '   - Sleep de geslicete sprites in het veld "Frames" en sleep "sticker_sfx.wav" in "Sticker Sfx".',
    '   - Roep in je code aan: animator.PlaySticker();',
    '   - Stel FPS en Frame Count per variant in volgens unity_import_meta.json.',
    '   - Houd dezelfde pixels-per-unit aan voor alle toetsformaten; de cel bevat transparante effectruimte.',
    '',
    '3. REFERENTIE VINGERKLEUREN (HEX):',
    `   - Pink              : ${opts.fingerColors?.pinky || '#745c39'}`,
    `   - Ringvinger        : ${opts.fingerColors?.ring || '#506b43'}`,
    `   - Middelvinger      : ${opts.fingerColors?.middle || '#693d44'}`,
    `   - Wijsvinger Links  : ${opts.fingerColors?.index || '#456d74'}`,
    `   - Wijsvinger Rechts : ${opts.fingerColors?.index_right || '#375169'}`,
    `   - Duim (Spatie)     : ${opts.fingerColors?.thumb || '#725575'}`,
    ''
  );
  return lines.join('\r\n');
}

/**
 * Resolve the list of animation targets based on targetScope.
 */
export function resolveUnityTargets(rawOpts, targetScope = 'finger_colors', { sizeScope = 'standard_size', contentMode = 'sticker_only' } = {}) {
  const opts = normalizeKeyboardOpts(rawOpts);
  const flat = getFlatKeys(opts.layout);
  const byId = Object.fromEntries(flat.map((k) => [k.id, k]));
  // Reference 1u key for universal sticker sprites (e.g. 'f' key in center of board)
  const ref1uKeyId = byId.f ? 'f' : flat.find((k) => k.w === 1 && !k.isoEnter)?.id || flat[0].id;

  const current = byId[opts.previewKey] || flat[0];
  const selected = opts.selectedKeys.map((id) => byId[id]);
  const exactKeys = targetScope === 'current_key' || targetScope === 'selected_keys';
  const makeTarget = (key, fingerId, exact = false) => {
    const color = fingerId === 'master_white' ? '#ffffff' : opts.fingerColors[fingerId];
    const sizeId = unityKeySizeId(key);
    const direction = opts.stickerStyle === 'peel' ? '' : `_${key.hand}`;
    const finger = FINGERS.find((f) => f.id === fingerId);
    return {
      slug: exact ? `toets_${keyExportSlug(key)}_${key.id}` : `sticker_${fingerId}_${color.slice(1)}_${sizeId}${direction}`,
      label: exact ? `Toets "${key.label}"` : `${finger?.name || 'Master Wit'} · ${sizeId.replaceAll('_', ' ')}${direction ? ` · ${key.hand === 'left' ? 'links' : key.hand === 'right' ? 'rechts' : 'midden'}` : ''}`,
      keyId: key.id,
      sizeId,
      widthUnits: key.w,
      isoEnter: key.isoEnter,
      hand: key.hand,
      colorOverride: color,
      fingerId,
    };
  };
  if (exactKeys) {
    return (targetScope === 'current_key' ? [current] : selected).map((key) => makeTarget(key, key.finger, true));
  }
  let sizeKeys = sizeScope === 'all_sizes' ? flat
    : sizeScope === 'current_size' ? flat.filter((key) => unityKeySizeId(key) === unityKeySizeId(current))
    : sizeScope === 'used_sizes' ? selected : flat.filter((key) => unityKeySizeId(key) === '1u');
  const preserveLabels = contentMode !== 'sticker_only' || !opts.blankSticker;
  if (targetScope === 'used_colors' && sizeScope === 'used_sizes') {
    const seen = new Set();
    return selected.filter((key) => {
      const id = `${unityKeySizeId(key)}_${opts.fingerColors[key.finger]}_${opts.stickerStyle === 'peel' ? '' : key.hand}_${preserveLabels ? key.id : ''}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map((key) => makeTarget(key, key.finger, preserveLabels));
  }
  const fingers = targetScope === 'white_tintable' ? ['master_white']
    : targetScope === 'current_color' ? [current.finger]
    : targetScope === 'used_colors' ? [...new Set(selected.map((key) => key.finger))]
    : FINGERS.map((f) => f.id);
  const sizes = [...new Set(sizeKeys.map(unityKeySizeId))];
  return sizes.flatMap((sizeId) => fingers.map((fingerId) => {
    const candidates = sizeKeys.filter((key) => unityKeySizeId(key) === sizeId);
    // A right-hand sticker must keep the right-hand pop/slide direction.
    const key = candidates.find((k) => k.finger === fingerId)
      || candidates.find((k) => k.hand === (fingerId === 'index_right' ? 'right' : current.hand))
      || candidates.find((k) => k.id === ref1uKeyId) || candidates[0];
    return makeTarget(key, fingerId);
  }));
}

/**
 * Render a single Unity target into a Sprite Sheet PNG and/or individual frame PNGs.
 */
export async function renderUnityTargetSprites({
  target,
  opts,
  bgImage = null,
  contentMode = 'sticker_only', // 'sticker_only' | 'key_and_sticker' | 'full_board'
  baseCellSize = 256,           // 256 | 384 | 512 (for 1u key box)
  fps = 30,
  trimStillDelays = true,
  includeBurst = true,
  includePress = true,
  wantSpriteSheet = true,
  wantFrames = false,
  preStickeredIds = [],
  signal = null,
  onFrameProgress = () => {},
}) {
  const normOpts = normalizeKeyboardOpts(opts);
  const spriteMode = contentMode === 'full_board' ? null : contentMode;
  const effectiveOpts =
    contentMode === 'full_board'
      ? { ...normOpts, bgMode: 'transparent' }
      : normOpts;

  // Measure target key logical box first
  const probeCanvas = document.createElement('canvas');
  probeCanvas.width = 256;
  probeCanvas.height = 256;
  const probeScene = createKeyboardScene(probeCanvas, target.keyId, effectiveOpts, {
    bgImage,
    spriteMode,
    colorOverride: target.colorOverride,
    includeBurst,
    includePress,
    preStickeredIds,
  });

  const { cellWidth, cellHeight, keyPixelWidth, keyPixelHeight } = unityFrameSize(probeScene.spriteBox, contentMode, baseCellSize);

  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = cellWidth;
  frameCanvas.height = cellHeight;

  const scene = createKeyboardScene(frameCanvas, target.keyId, effectiveOpts, {
    bgImage,
    spriteMode,
    colorOverride: target.colorOverride,
    includeBurst,
    includePress,
    preStickeredIds,
  });

  const timing = unityClipTiming(scene.schedule, {
    contentMode,
    trimStillDelays,
    fps,
  });
  const { tStart, tEnd, frameCount, duration: clipDuration } = timing;

  const preferredColumns = contentMode === 'full_board'
    ? Math.min(4, frameCount)
    : Math.min(8, Math.max(4, Math.ceil(Math.sqrt(frameCount))));
  // Unity supports texture sizes up to 16384. Fail before allocating an
  // unsupported canvas rather than silently returning an empty PNG.
  const maxColumns = Math.floor(16384 / cellWidth);
  const minColumns = Math.ceil(frameCount / Math.floor(16384 / cellHeight));
  if (wantSpriteSheet && (maxColumns < 1 || minColumns > maxColumns)) {
    throw new Error('Deze spritesheet is te groot. Kies een lagere resolutie/FPS of losse PNG-frames.');
  }
  const columns = Math.max(1, Math.min(maxColumns, Math.max(minColumns, preferredColumns)));
  const rows = Math.ceil(frameCount / columns);

  let sheetCanvas = null;
  let sheetCtx = null;
  if (wantSpriteSheet) {
    sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = columns * cellWidth;
    sheetCanvas.height = rows * cellHeight;
    sheetCtx = sheetCanvas.getContext('2d');
    sheetCtx.clearRect(0, 0, sheetCanvas.width, sheetCanvas.height);
  }

  const frameBlobs = [];
  for (let i = 0; i < frameCount; i++) {
    if (signal?.aborted) throw new DOMException('Geannuleerd', 'AbortError');
    const t = unityFrameTime(timing, i);
    scene.draw(t);

    if (wantSpriteSheet && sheetCtx) {
      const col = i % columns;
      const row = Math.floor(i / columns);
      sheetCtx.drawImage(frameCanvas, col * cellWidth, row * cellHeight);
    }

    if (wantFrames) {
      const blob = await canvasToPngBlob(frameCanvas);
      frameBlobs.push({
        index: i,
        filename: `frame_${String(i).padStart(3, '0')}.png`,
        blob,
      });
    }

    if (i % 4 === 0 || i === frameCount - 1) {
      onFrameProgress((i + 1) / frameCount);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const sheetFilename = `${target.slug}_${cellWidth}x${cellHeight}_${columns}x${rows}_${fps}fps.png`;
  const spriteSheetBlob = wantSpriteSheet && sheetCanvas ? await canvasToPngBlob(sheetCanvas) : null;

  const wavBlob = encodeWav(sliceUnityAudio(scene.soundtrack, timing), SR);

  const meta = {
    slug: target.slug,
    label: target.label,
    fingerId: target.fingerId,
    colorHex: target.colorOverride,
    keyId: target.keyId,
    sizeId: target.sizeId,
    widthUnits: target.widthUnits,
    hand: target.hand,
    isoEnter: target.isoEnter,
    filename: sheetFilename,
    contentMode,
    cellWidth,
    cellHeight,
    keyPixelWidth,
    keyPixelHeight,
    pivot: { x: 0.5, y: 0.5 },
    columns,
    rows,
    frameCount,
    fps,
    durationSeconds: Number(clipDuration.toFixed(3)),
    sourceStartSeconds: tStart,
    sourceEndSeconds: tEnd,
    frameOrder: 'row-major-top-left',
    frames: Array.from({ length: frameCount }, (_, index) => ({
      index,
      name: `frame_${String(index).padStart(3, '0')}`,
      x: (index % columns) * cellWidth,
      y: (rows - 1 - Math.floor(index / columns)) * cellHeight,
      width: cellWidth,
      height: cellHeight,
      timeSeconds: index / fps,
      sourceTimeSeconds: unityFrameTime(timing, index),
    })),
  };

  scene.dispose();
  probeScene.dispose();
  // Release backing stores between variants instead of waiting for GC during
  // an export of every size and color.
  frameCanvas.width = frameCanvas.height = 1;
  probeCanvas.width = probeCanvas.height = 1;
  if (sheetCanvas) sheetCanvas.width = sheetCanvas.height = 1;

  return {
    meta,
    spriteSheetBlob,
    frameBlobs,
    wavBlob,
  };
}

