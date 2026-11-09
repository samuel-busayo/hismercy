"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Upload,
  ZoomIn,
  ZoomOut,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Download,
  Share2,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Clock,
  MapPin,
  Phone,
  Sparkles,
  ShieldCheck,
  Edit3,
  RefreshCw,
  MessageCircle,
  Image as ImageIcon,
  User,
  Maximize2,
  Minimize2,
  X,
  Camera,
  Wand2,
  Layers,
  Type,
  Minus,
  Plus,
} from "lucide-react";
import { EVENT_DATA } from "@/data/eventData";
import {
  MASTER_WIDTH,
  MASTER_HEIGHT,
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  PhotoAdjustments,
  DEFAULT_ADJUSTMENTS,
  renderPersonalisedPoster,
} from "@/lib/posterComposer";
import { removePhotoBackground } from "@/lib/backgroundRemover";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_NAME_LENGTH = 45;
const MAX_LOCATION_LENGTH = 45;

export default function HarvestPosterApp() {
  // Master flyer image loaded once in browser memory
  const [masterImage, setMasterImage] = useState<HTMLImageElement | null>(null);
  const [masterLoadError, setMasterLoadError] = useState<string | null>(null);

  // Visitor photograph state (both original and background-removed cutout)
  const [originalPhoto, setOriginalPhoto] = useState<HTMLImageElement | null>(null);
  const [cutoutPhoto, setCutoutPhoto] = useState<HTMLImageElement | null>(null);
  const [useCutout, setUseCutout] = useState<boolean>(true);
  const [isRemovingBg, setIsRemovingBg] = useState<boolean>(false);

  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoFileName, setPhotoFileName] = useState<string>("");
  const [visitorName, setVisitorName] = useState<string>("");
  const [visitorLocation, setVisitorLocation] = useState<string>("");
  const [adjustments, setAdjustments] = useState<PhotoAdjustments>(DEFAULT_ADJUSTMENTS);

  // Active photo to render on the poster (cutout when enabled & available, otherwise original)
  const activeVisitorPhoto = useCutout && cutoutPhoto ? cutoutPhoto : originalPhoto;

  // Mobile-friendly view mode for the live preview
  const [focusBottomPanel, setFocusBottomPanel] = useState<boolean>(false);

  // Validation & feedback messages
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Generated poster state (for Section 5.4 & 5.5)
  const [generatedPngUrl, setGeneratedPngUrl] = useState<string | null>(null);
  const [generatedBlob, setGeneratedBlob] = useState<Blob | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [shareStatusMessage, setShareStatusMessage] = useState<string | null>(null);
  const [showWhatsappFallbackNote, setShowWhatsappFallbackNote] = useState<boolean>(false);

  // Interactive drag-to-pan state on the live preview canvas
  const [isDraggingPhoto, setIsDraggingPhoto] = useState<boolean>(false);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  // Refs
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewSectionRef = useRef<HTMLElement | null>(null);
  const createSectionRef = useRef<HTMLElement | null>(null);

  // 1. Load the official master flyer (1489 x 2047) on mount
  useEffect(() => {
    let isMounted = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      if (!isMounted) return;
      try {
        if (typeof document !== "undefined" && "fonts" in document) {
          await document.fonts.ready;
        }
      } catch {
        // Proceed even if font readiness promise fails
      }
      if (isMounted) {
        setMasterImage(img);
      }
    };
    img.onerror = () => {
      if (isMounted) {
        setMasterLoadError(
          "Unable to load the official harvest flyer artwork. Please refresh the page."
        );
      }
    };
    img.src = "/flyer-master.jpg";

    return () => {
      isMounted = false;
    };
  }, []);

  // Clean up temporary object URLs on unmount
  useEffect(() => {
    return () => {
      if (photoPreviewUrl && photoPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  useEffect(() => {
    return () => {
      if (generatedPngUrl && generatedPngUrl.startsWith("blob:")) {
        URL.revokeObjectURL(generatedPngUrl);
      }
    };
  }, [generatedPngUrl]);

  // 2. Re-render the live editor canvas throttled via requestAnimationFrame at lightweight PREVIEW_WIDTH x PREVIEW_HEIGHT
  //    so mobile touch-dragging and slider adjustments never overwhelm mobile GPU/memory or crash the browser
  useEffect(() => {
    const canvas = liveCanvasRef.current;
    if (!canvas || !masterImage) return;

    const rafId = window.requestAnimationFrame(() => {
      try {
        renderPersonalisedPoster(
          canvas,
          masterImage,
          activeVisitorPhoto,
          visitorName,
          adjustments,
          {
            showPhotoPlaceholderHint: !activeVisitorPhoto,
            visitorLocation,
            targetWidth: PREVIEW_WIDTH,
            targetHeight: PREVIEW_HEIGHT,
          }
        );
      } catch {
        // Safeguard against transient canvas context errors on mobile browsers
      }
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [masterImage, activeVisitorPhoto, visitorName, visitorLocation, adjustments]);

  // 3. Handle visitor photograph selection, validation & automatic AI background removal
  const processSelectedFile = useCallback(
    (file: File) => {
      setUploadError(null);
      setFormError(null);

      const normalizedType = file.type.toLowerCase();
      const hasValidExt = /\.(jpe?g|png|webp)$/i.test(file.name);
      if (!ALLOWED_MIME_TYPES.includes(normalizedType) && !hasValidExt) {
        setUploadError(
          "Unsupported file format. Please choose a JPG, JPEG, PNG, or WebP photograph."
        );
        return;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        setUploadError(
          `This image is ${sizeMb} MB, which exceeds the 10 MB maximum limit. Please select a smaller photograph.`
        );
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = async () => {
        if (photoPreviewUrl && photoPreviewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(photoPreviewUrl);
        }
        setPhotoPreviewUrl(objectUrl);
        setOriginalPhoto(img);
        setCutoutPhoto(null);
        setUseCutout(true);
        setPhotoFileName(file.name);
        setAdjustments((prev) => ({
          ...DEFAULT_ADJUSTMENTS,
          nameScale: prev.nameScale,
          locationScale: prev.locationScale,
        }));
        setGeneratedPngUrl(null);
        setGeneratedBlob(null);

        if (typeof window !== "undefined" && window.innerWidth < 768) {
          setFocusBottomPanel(true);
        }

        setIsRemovingBg(true);
        try {
          const removedBgImg = await removePhotoBackground(img);
          setCutoutPhoto(removedBgImg);
          setPhotoPreviewUrl(removedBgImg.src);
        } catch {
          // Keep original photo if segmentation is unsupported on device
        } finally {
          setIsRemovingBg(false);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setUploadError(
          "We could not read that image file. Please try another photograph from your device."
        );
      };
      img.src = objectUrl;
    },
    [photoPreviewUrl]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  // Manual toggle or re-run background removal
  const handleToggleBackgroundRemoval = async () => {
    if (!originalPhoto) return;
    setGeneratedPngUrl(null);
    setGeneratedBlob(null);

    if (useCutout) {
      setUseCutout(false);
      return;
    }

    setUseCutout(true);
    if (!cutoutPhoto) {
      setIsRemovingBg(true);
      try {
        const removed = await removePhotoBackground(originalPhoto);
        setCutoutPhoto(removed);
      } catch {
        // Keep original if failed
      } finally {
        setIsRemovingBg(false);
      }
    }
  };

  // 4. Handle Name & Location/Parish inputs (allows letters, numbers, spaces, and special characters)
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const sanitized = raw.replace(/[\r\n\t]+/g, " ").slice(0, MAX_NAME_LENGTH);
    setVisitorName(sanitized);
    if (sanitized.trim().length > 0) {
      setFormError(null);
    }
    setGeneratedPngUrl(null);
    setGeneratedBlob(null);
  };

  const handleLocationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const sanitized = raw.replace(/[\r\n\t]+/g, " ").slice(0, MAX_LOCATION_LENGTH);
    setVisitorLocation(sanitized);
    setGeneratedPngUrl(null);
    setGeneratedBlob(null);
  };

  // 5. Image & Text Size adjustment controls
  const adjustZoom = (delta: number) => {
    setAdjustments((prev) => ({
      ...prev,
      zoom: Number(Math.max(0.4, Math.min(3.0, prev.zoom + delta)).toFixed(2)),
    }));
    setGeneratedPngUrl(null);
  };

  const adjustPan = (dx: number, dy: number) => {
    setAdjustments((prev) => ({
      ...prev,
      offsetX: Math.max(-100, Math.min(100, prev.offsetX + dx)),
      offsetY: Math.max(-100, Math.min(100, prev.offsetY + dy)),
    }));
    setGeneratedPngUrl(null);
  };

  const adjustNameScale = (delta: number) => {
    setAdjustments((prev) => ({
      ...prev,
      nameScale: Number(Math.max(0.5, Math.min(1.3, prev.nameScale + delta)).toFixed(2)),
    }));
    setGeneratedPngUrl(null);
  };

  const adjustLocationScale = (delta: number) => {
    setAdjustments((prev) => ({
      ...prev,
      locationScale: Number(
        Math.max(0.5, Math.min(1.3, prev.locationScale + delta)).toFixed(2)
      ),
    }));
    setGeneratedPngUrl(null);
  };

  const toggleOverflowMode = () => {
    setAdjustments((prev) => ({
      ...prev,
      allowOverflow: !prev.allowOverflow,
    }));
    setGeneratedPngUrl(null);
  };

  const resetAdjustments = () => {
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setGeneratedPngUrl(null);
  };

  // Crash-safe pointer drag handlers for mobile touch & desktop mouse
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeVisitorPhoto) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unsupported on target mobile browser
    }
    setIsDraggingPhoto(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startOffsetX: adjustments.offsetX,
      startOffsetY: adjustments.offsetY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const dragStart = dragStartRef.current;
    if (!isDraggingPhoto || !dragStart) return;

    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    const sensitivity = focusBottomPanel ? 0.32 : 0.52;

    // Compute values BEFORE calling setAdjustments so dragStartRef is never read asynchronously after nulling
    const nextOffsetX = Math.round(
      Math.max(-100, Math.min(100, dragStart.startOffsetX + dx * sensitivity))
    );
    const nextOffsetY = Math.round(
      Math.max(-100, Math.min(100, dragStart.startOffsetY + dy * sensitivity))
    );

    setAdjustments((prev) => {
      if (prev.offsetX === nextOffsetX && prev.offsetY === nextOffsetY) {
        return prev;
      }
      return {
        ...prev,
        offsetX: nextOffsetX,
        offsetY: nextOffsetY,
      };
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    setIsDraggingPhoto(false);
    dragStartRef.current = null;
  };

  // 6. Generate final high-resolution poster on a dedicated working canvas (1489 x 2047)
  const handleGeneratePoster = async () => {
    setFormError(null);
    setShareStatusMessage(null);
    setShowWhatsappFallbackNote(false);

    if (!activeVisitorPhoto) {
      setFormError(
        "Please upload your photograph first so we can add it to your attendance poster."
      );
      return;
    }

    if (!visitorName.trim()) {
      setFormError(
        "Please enter your name in the 'Enter Your Name' field before generating your poster."
      );
      return;
    }

    if (!masterImage) {
      setFormError("The official flyer is still loading. Please wait a moment and try again.");
      return;
    }

    setIsGenerating(true);

    try {
      if (typeof document !== "undefined" && "fonts" in document) {
        await document.fonts.ready;
      }

      const workingCanvas = document.createElement("canvas");
      workingCanvas.width = MASTER_WIDTH;
      workingCanvas.height = MASTER_HEIGHT;

      renderPersonalisedPoster(
        workingCanvas,
        masterImage,
        activeVisitorPhoto,
        visitorName.trim(),
        adjustments,
        {
          showPhotoPlaceholderHint: false,
          visitorLocation,
          targetWidth: MASTER_WIDTH,
          targetHeight: MASTER_HEIGHT,
        }
      );

      workingCanvas.toBlob(
        (blob) => {
          if (blob) {
            if (generatedPngUrl && generatedPngUrl.startsWith("blob:")) {
              URL.revokeObjectURL(generatedPngUrl);
            }
            const blobUrl = URL.createObjectURL(blob);
            setGeneratedBlob(blob);
            setGeneratedPngUrl(blobUrl);
          } else {
            const fallbackDataUrl = workingCanvas.toDataURL("image/png", 1.0);
            setGeneratedPngUrl(fallbackDataUrl);
          }
          setIsGenerating(false);
          setTimeout(() => {
            previewSectionRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }, 80);
        },
        "image/png",
        1.0
      );
    } catch {
      setIsGenerating(false);
      setFormError("Something went wrong while generating your poster. Please try again.");
    }
  };

  const getDownloadFilename = () => {
    const safeSlug =
      visitorName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "attendee";
    return `His-Mercy-At-15-${safeSlug}.png`;
  };

  // 7. Download PNG (Section 5.5)
  const handleDownloadPoster = () => {
    if (!generatedPngUrl) return;
    const link = document.createElement("a");
    link.href = generatedPngUrl;
    link.download = getDownloadFilename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 8. Native Web Share API + WhatsApp Fallback (Section 5.5)
  const handleSharePoster = async () => {
    setShareStatusMessage(null);
    if (!generatedBlob || !generatedPngUrl) return;

    const filename = getDownloadFilename();
    const posterFile = new File([generatedBlob], filename, { type: "image/png" });

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [posterFile] })
    ) {
      try {
        await navigator.share({
          title: "His Mercy @15",
          text: EVENT_DATA.whatsappShareMessage,
          files: [posterFile],
        });
        setShareStatusMessage("Poster shared successfully!");
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          return;
        }
      }
    }

    setShowWhatsappFallbackNote(true);
  };

  const handleWhatsAppShare = async () => {
    setShareStatusMessage(null);

    if (generatedBlob) {
      const posterFile = new File([generatedBlob], getDownloadFilename(), {
        type: "image/png",
      });
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [posterFile] })
      ) {
        try {
          await navigator.share({
            title: "His Mercy @15",
            text: EVENT_DATA.whatsappShareMessage,
            files: [posterFile],
          });
          return;
        } catch (err) {
          if ((err as Error)?.name === "AbortError") {
            return;
          }
        }
      }
    }

    setShowWhatsappFallbackNote(true);
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(
      EVENT_DATA.whatsappShareMessage
    )}`;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  };

  // 9. Create Another Poster / Reset (Section 5.5)
  const handleCreateAnotherPoster = () => {
    if (photoPreviewUrl && photoPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    if (generatedPngUrl && generatedPngUrl.startsWith("blob:")) {
      URL.revokeObjectURL(generatedPngUrl);
    }
    setOriginalPhoto(null);
    setCutoutPhoto(null);
    setUseCutout(true);
    setIsRemovingBg(false);
    setPhotoPreviewUrl(null);
    setPhotoFileName("");
    setVisitorName("");
    setVisitorLocation("");
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setGeneratedPngUrl(null);
    setGeneratedBlob(null);
    setUploadError(null);
    setFormError(null);
    setShareStatusMessage(null);
    setShowWhatsappFallbackNote(false);
    setFocusBottomPanel(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    createSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleReturnToEdit = () => {
    createSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#fdfaf2] text-[#220910]">
      {/* TOP STICKY HEADER WITH OFFICIAL CHURCH LOGO */}
      <header className="sticky top-0 z-40 bg-[#fdfaf2]/95 backdrop-blur-md border-b-2 border-[#f5b82e] shadow-sm">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2 sm:py-2.5 flex items-center justify-between gap-2">
          <a
            href="#"
            className="flex items-center gap-2.5 group focus:outline-none"
            aria-label="Celestial Church of Christ, His Mercy Parish – Home"
          >
            <img
              src="/logo.png"
              alt="Celestial Church of Christ, His Mercy Parish [Confirm Ministry] Logo"
              className="h-10 sm:h-12 w-auto object-contain shrink-0"
            />
          </a>

          <nav className="flex items-center gap-2 sm:gap-5">
            <a
              href="#event-info"
              className="hidden sm:inline-block text-sm font-bold text-[#480816] hover:text-[#85142e] transition-colors"
            >
              Event Info
            </a>
            <a
              href="#create-poster"
              className="inline-flex items-center gap-1.5 bg-[#680d22] hover:bg-[#480816] active:scale-[0.98] text-[#f5b82e] font-bold text-xs sm:text-sm px-3.5 sm:px-4 py-2.5 rounded-full shadow-sm transition-all"
            >
              <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>Create Poster</span>
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* 5.1 LANDING PAGE / MOBILE-FIRST HERO SECTION */}
        <section className="relative bg-gradient-to-b from-[#480816] via-[#680d22] to-[#4e0918] text-[#fdfaf2] py-7 sm:py-14 lg:py-16 border-b-4 border-[#f5b82e]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 lg:gap-12 items-center">
              {/* Campaign Copy & Primary Mobile CTA */}
              <div className="lg:col-span-7 space-y-4 sm:space-y-6 text-center lg:text-left">
                {/* Official Logo Badge on Cream Pill for High Contrast */}
                <div className="inline-flex flex-col sm:flex-row items-center gap-2 sm:gap-3 bg-[#fdfaf2] px-4 py-2 rounded-2xl shadow-md border-2 border-[#f5b82e]">
                  <img
                    src="/logo.png"
                    alt="His Mercy Parish Logo"
                    className="h-11 sm:h-12 w-auto object-contain"
                  />
                  <span className="hidden sm:inline-block h-7 w-px bg-[#d5c9b1]" />
                  <span className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider text-[#680d22]">
                    {EVENT_DATA.eventTitle} • Dec 4 &amp; 6, 2026
                  </span>
                </div>

                <h1
                  className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-none"
                  style={{ fontFamily: "var(--font-oswald)" }}
                >
                  {EVENT_DATA.landing.heading}
                </h1>

                <p className="text-base sm:text-xl text-[#f5b82e] font-bold">
                  Theme: &ldquo;{EVENT_DATA.theme}&rdquo;
                </p>

                <p className="text-sm sm:text-lg text-[#f7f1e1]/90 leading-relaxed max-w-xl mx-auto lg:mx-0">
                  {EVENT_DATA.landing.supportingText}
                </p>

                {/* Primary Thumb-Friendly CTA Buttons */}
                <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center justify-center lg:justify-start gap-3">
                  <a
                    href="#create-poster"
                    className="w-full sm:w-auto min-h-[54px] inline-flex items-center justify-center gap-2.5 bg-[#f5b82e] hover:bg-[#ffca4b] active:scale-[0.99] text-[#3d0613] font-extrabold text-base sm:text-lg px-7 py-3.5 rounded-xl shadow-lg transition-all"
                  >
                    <Camera className="w-5 h-5 shrink-0" />
                    <span>{EVENT_DATA.landing.primaryCta}</span>
                  </a>
                  <a
                    href="#event-info"
                    className="w-full sm:w-auto min-h-[48px] inline-flex items-center justify-center gap-2 border border-[#f5b82e]/50 hover:bg-[#f5b82e]/10 text-[#fdfaf2] font-semibold text-sm sm:text-base px-5 py-3 rounded-xl transition-colors"
                  >
                    <Calendar className="w-4 h-4 text-[#f5b82e] shrink-0" />
                    <span>Programme Schedule</span>
                  </a>
                </div>

                {/* Compact 3-Step Strip for Phone Users */}
                <div className="pt-2 grid grid-cols-3 gap-2 sm:gap-3 text-left">
                  <div className="bg-black/25 rounded-xl p-2.5 sm:p-3 border border-white/10">
                    <span className="text-[10px] sm:text-xs font-bold uppercase text-[#f5b82e]">
                      1. Upload
                    </span>
                    <p className="text-xs sm:text-sm font-semibold text-white mt-0.5 leading-snug">
                      Auto background cutout
                    </p>
                  </div>
                  <div className="bg-black/25 rounded-xl p-2.5 sm:p-3 border border-white/10">
                    <span className="text-[10px] sm:text-xs font-bold uppercase text-[#f5b82e]">
                      2. Details
                    </span>
                    <p className="text-xs sm:text-sm font-semibold text-white mt-0.5 leading-snug">
                      Name &amp; Location/Parish
                    </p>
                  </div>
                  <div className="bg-black/25 rounded-xl p-2.5 sm:p-3 border border-white/10">
                    <span className="text-[10px] sm:text-xs font-bold uppercase text-[#f5b82e]">
                      3. Share
                    </span>
                    <p className="text-xs sm:text-sm font-semibold text-white mt-0.5 leading-snug">
                      Save &amp; WhatsApp
                    </p>
                  </div>
                </div>
              </div>

              {/* Official Harvest Flyer Preview */}
              <div className="lg:col-span-5 flex justify-center">
                <a
                  href="#create-poster"
                  className="group relative w-full max-w-[260px] sm:max-w-sm rounded-2xl p-2 bg-gradient-to-b from-[#f5b82e] via-[#d49514] to-[#f5b82e] shadow-2xl block"
                >
                  <div className="rounded-xl overflow-hidden bg-[#3d0613]">
                    <img
                      src="/flyer-master.jpg"
                      alt="Official 15th Annual Adult Harvest Flyer – Celestial Church of Christ, His Mercy Parish"
                      width={MASTER_WIDTH}
                      height={MASTER_HEIGHT}
                      className="w-full h-auto block"
                    />
                  </div>
                  <div className="mt-1.5 text-center">
                    <span className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider text-[#3d0613]">
                      Tap to Personalise Your Flyer ↓
                    </span>
                  </div>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* 5.3 POSTER CREATION SECTION */}
        <section
          id="create-poster"
          ref={createSectionRef}
          className="py-8 sm:py-14 bg-[#fdfaf2] scroll-mt-14"
        >
          <div className="max-w-6xl mx-auto px-3.5 sm:px-6 space-y-6 sm:space-y-8">
            <div className="text-center max-w-2xl mx-auto space-y-1.5">
              <span className="inline-block px-3 py-1 rounded-full bg-[#680d22]/10 text-[#680d22] text-[11px] sm:text-xs font-bold uppercase tracking-wider">
                His Mercy @15 • Personalised Poster Studio
              </span>
              <h2
                className="text-2xl sm:text-4xl font-extrabold text-[#3d0613]"
                style={{ fontFamily: "var(--font-oswald)" }}
              >
                CREATE YOUR &ldquo;I WILL BE THERE&rdquo; POSTER
              </h2>
              <p className="text-xs sm:text-base text-[#5a2230]">
                Upload your picture, enter your name and location or parish, and adjust your
                cutout and text size.
              </p>
            </div>

            {masterLoadError && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-300 text-red-900 flex items-center gap-3 text-xs sm:text-sm font-medium">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                <span>{masterLoadError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-x-10 lg:gap-y-6 items-start">
              {/* BLOCK A (Step 1 Photo + Step 2 Name & Location/Parish): Top-Left on Desktop, 1st on Mobile */}
              <div className="lg:col-span-6 space-y-5 bg-[#f7f1e1] p-4 sm:p-6 rounded-2xl border-2 border-[#e5dcc8] shadow-sm">
                {/* STEP 1: PHOTOGRAPH UPLOAD & AI BACKGROUND REMOVAL */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="visitor-photo-upload"
                      className="flex items-center gap-2 text-sm sm:text-base font-extrabold text-[#3d0613]"
                    >
                      <span className="w-6 h-6 rounded-full bg-[#680d22] text-[#f5b82e] text-xs flex items-center justify-center font-bold shrink-0">
                        1
                      </span>
                      <span>Upload Your Photograph</span>
                      <span className="text-red-600">*</span>
                    </label>
                    <span className="text-[11px] text-[#680d22] font-semibold">
                      Max 10 MB
                    </span>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleFileChange}
                    className="hidden"
                    id="visitor-photo-upload"
                  />

                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="cursor-pointer rounded-xl border-2 border-dashed border-[#680d22]/45 bg-[#fdfaf2] hover:border-[#680d22] active:bg-[#f7f1e1] p-3.5 sm:p-4 transition-all"
                  >
                    {originalPhoto ? (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden border-2 border-[#f5b82e] shrink-0"
                            style={{
                              backgroundImage:
                                "repeating-conic-gradient(#e5dcc8 0% 25%, #fdfaf2 0% 50%)",
                              backgroundSize: "12px 12px",
                            }}
                          >
                            {photoPreviewUrl && (
                              <img
                                src={photoPreviewUrl}
                                alt="Selected visitor preview"
                                className="w-full h-full object-contain"
                              />
                            )}
                          </div>
                          <div className="min-w-0 text-left">
                            {isRemovingBg ? (
                              <p className="text-xs font-bold text-[#680d22] flex items-center gap-1.5">
                                <Wand2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                <span>Removing Background...</span>
                              </p>
                            ) : (
                              <p className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {useCutout && cutoutPhoto
                                    ? "Background Removed!"
                                    : "Photo Loaded"}
                                </span>
                              </p>
                            )}
                            <p className="text-xs sm:text-sm font-bold text-[#3d0613] truncate mt-0.5">
                              {photoFileName}
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 px-3 py-2 rounded-lg bg-[#680d22] text-[#f5b82e] text-xs font-bold">
                          Change Photo
                        </span>
                      </div>
                    ) : (
                      <div className="py-2 flex items-center sm:flex-col justify-center gap-3.5 sm:gap-2 text-left sm:text-center">
                        <div className="w-12 h-12 rounded-full bg-[#680d22] text-[#f5b82e] flex items-center justify-center shrink-0 shadow-sm">
                          <Upload className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm sm:text-base font-extrabold text-[#3d0613]">
                            Tap to select a photo from your phone
                          </p>
                          <p className="text-xs text-[#5a2230]">
                            Background is removed automatically • JPG, PNG, WebP
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Background Removal Toggle Bar */}
                  {originalPhoto && (
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-[#fdfaf2] px-3.5 py-2.5 rounded-xl border border-[#e5dcc8]">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#3d0613]">
                        <Wand2 className="w-4 h-4 text-[#680d22] shrink-0" />
                        <span>Photo Background Removal:</span>
                      </div>
                      <button
                        type="button"
                        disabled={isRemovingBg}
                        onClick={handleToggleBackgroundRemoval}
                        className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                          useCutout
                            ? "bg-emerald-700 text-white shadow-xs"
                            : "bg-[#e5dcc8] text-[#3d0613] hover:bg-[#d5c9b1]"
                        }`}
                      >
                        {isRemovingBg
                          ? "Removing Background..."
                          : useCutout
                          ? "✓ Background Removed (Tap to Keep BG)"
                          : "Remove Background Now"}
                      </button>
                    </div>
                  )}

                  {uploadError && (
                    <div
                      role="alert"
                      className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-800 text-xs font-medium flex items-start gap-2"
                    >
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <span>{uploadError}</span>
                    </div>
                  )}
                </div>

                {/* STEP 2: NAME & LOCATION / PARISH INPUTS */}
                <div className="space-y-3.5 pt-3 border-t border-[#e5dcc8]">
                  {/* Visitor Name Field */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="visitor-name-input"
                        className="flex items-center gap-2 text-sm sm:text-base font-extrabold text-[#3d0613]"
                      >
                        <span className="w-6 h-6 rounded-full bg-[#680d22] text-[#f5b82e] text-xs flex items-center justify-center font-bold shrink-0">
                          2
                        </span>
                        <span>Enter Your Name</span>
                        <span className="text-red-600">*</span>
                      </label>
                      <span className="text-xs font-semibold text-[#5a2230]">
                        {visitorName.length}/{MAX_NAME_LENGTH}
                      </span>
                    </div>

                    <div className="relative">
                      <User className="w-5 h-5 text-[#680d22]/60 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="visitor-name-input"
                        type="text"
                        required
                        enterKeyHint="next"
                        autoComplete="name"
                        value={visitorName}
                        onChange={handleNameChange}
                        placeholder="e.g. Bro. Adewale Ogunleye"
                        maxLength={MAX_NAME_LENGTH}
                        className="w-full pl-11 pr-10 py-3 rounded-xl bg-[#fdfaf2] border-2 border-[#d5c9b1] focus:border-[#680d22] focus:outline-none text-base font-bold text-[#220910] placeholder:font-normal placeholder:text-[#846b72]"
                      />
                      {visitorName && (
                        <button
                          type="button"
                          onClick={() => {
                            setVisitorName("");
                            setGeneratedPngUrl(null);
                          }}
                          aria-label="Clear name"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-[#680d22]/70 hover:bg-[#e5dcc8]/50"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Location (City) or Parish Field */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="visitor-location-input"
                        className="flex items-center gap-2 text-xs sm:text-sm font-extrabold text-[#3d0613]"
                      >
                        <MapPin className="w-4 h-4 text-[#680d22] shrink-0" />
                        <span>Location (e.g. City) or Parish</span>
                        <span className="text-[11px] font-normal text-[#5a2230]">(Optional)</span>
                      </label>
                      <span className="text-xs font-semibold text-[#5a2230]">
                        {visitorLocation.length}/{MAX_LOCATION_LENGTH}
                      </span>
                    </div>

                    <div className="relative">
                      <MapPin className="w-5 h-5 text-[#680d22]/60 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="visitor-location-input"
                        type="text"
                        enterKeyHint="done"
                        value={visitorLocation}
                        onChange={handleLocationChange}
                        placeholder="e.g. Lagos, or His Mercy Parish"
                        maxLength={MAX_LOCATION_LENGTH}
                        className="w-full pl-11 pr-10 py-3 rounded-xl bg-[#fdfaf2] border-2 border-[#d5c9b1] focus:border-[#680d22] focus:outline-none text-base font-bold text-[#220910] placeholder:font-normal placeholder:text-[#846b72]"
                      />
                      {visitorLocation && (
                        <button
                          type="button"
                          onClick={() => {
                            setVisitorLocation("");
                            setGeneratedPngUrl(null);
                          }}
                          aria-label="Clear location or parish"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-[#680d22]/70 hover:bg-[#e5dcc8]/50"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-[#5a2230]">
                      Appears in brackets underneath your name — e.g.{" "}
                      <strong>({visitorLocation.trim() || "Location Or Parish"})</strong>
                    </p>
                  </div>
                </div>
              </div>

              {/* BLOCK B (Live Interactive Poster Preview): Right Column on Desktop, 2nd on Mobile */}
              <div className="lg:col-span-6 lg:col-start-7 lg:row-start-1 lg:row-span-2 flex flex-col items-center lg:sticky lg:top-20">
                <div className="w-full max-w-md space-y-2">
                  <div className="flex items-center justify-between px-1 gap-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-[#680d22] flex items-center gap-1.5">
                      <ImageIcon className="w-4 h-4 shrink-0" />
                      <span>
                        {focusBottomPanel
                          ? "Zoomed View: Personalised Panel"
                          : "Live Poster Preview"}
                      </span>
                    </span>

                    <button
                      type="button"
                      onClick={() => setFocusBottomPanel((prev) => !prev)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#680d22] text-[#f5b82e] text-xs font-bold transition-transform active:scale-95 cursor-pointer shadow-xs"
                    >
                      {focusBottomPanel ? (
                        <>
                          <Minimize2 className="w-3.5 h-3.5" />
                          <span>Full Flyer View</span>
                        </>
                      ) : (
                        <>
                          <Maximize2 className="w-3.5 h-3.5" />
                          <span>Zoom Bottom Panel</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="rounded-2xl p-2 bg-gradient-to-b from-[#680d22] to-[#3d0613] shadow-xl border-2 border-[#f5b82e]/70">
                    <div
                      className={`rounded-xl overflow-hidden bg-[#3d0613] relative transition-all duration-300 ${
                        focusBottomPanel ? "aspect-[1489/760]" : ""
                      }`}
                    >
                      <canvas
                        ref={liveCanvasRef}
                        width={PREVIEW_WIDTH}
                        height={PREVIEW_HEIGHT}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        className={`w-full h-auto block select-none transition-transform duration-300 ${
                          activeVisitorPhoto
                            ? "cursor-grab active:cursor-grabbing touch-none"
                            : ""
                        } ${focusBottomPanel ? "-translate-y-[61.5%]" : ""}`}
                      />
                    </div>

                    <div className="mt-1.5 px-2 flex items-center justify-between text-[11px] text-[#f7f1e1]/90">
                      <span>
                        {activeVisitorPhoto
                          ? "Drag your photo with your finger or use controls below"
                          : "Upload a photo above to preview"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setFocusBottomPanel((prev) => !prev)}
                        className="text-[#f5b82e] font-bold underline cursor-pointer shrink-0 ml-2"
                      >
                        {focusBottomPanel ? "See Full Flyer" : "Zoom In"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* BLOCK C (Step 3 Photo & Text Size Adjustments + Step 4 Generate Button): Bottom-Left on Desktop, 3rd on Mobile */}
              <div className="lg:col-span-6 lg:col-start-1 lg:row-start-2 space-y-5 bg-[#f7f1e1] p-4 sm:p-6 rounded-2xl border-2 border-[#e5dcc8] shadow-sm">
                {/* STEP 3: PHOTO POSITION, POP-OUT BORDER & TEXT SIZE CONTROLS */}
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm sm:text-base font-extrabold text-[#3d0613]">
                      <span className="w-6 h-6 rounded-full bg-[#680d22] text-[#f5b82e] text-xs flex items-center justify-center font-bold shrink-0">
                        3
                      </span>
                      <span>Adjust Photo &amp; Text Size</span>
                    </div>
                    <button
                      type="button"
                      onClick={resetAdjustments}
                      className="inline-flex items-center gap-1 text-xs font-bold text-[#680d22] hover:text-[#3d0613] cursor-pointer px-2.5 py-1.5 rounded-lg bg-[#fdfaf2] border border-[#d5c9b1]"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset All</span>
                    </button>
                  </div>

                  {/* TEXT SIZE CONTROLS (Name Size & Location/Parish Size) */}
                  <div className="bg-[#fdfaf2] p-3.5 sm:p-4 rounded-xl border border-[#e5dcc8] space-y-3">
                    <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#680d22]">
                      <Type className="w-4 h-4 shrink-0" />
                      <span>Name &amp; Location Text Size</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {/* Name Text Size Control */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-bold text-[#3d0613]">
                          <span>Name Size: {Math.round(adjustments.nameScale * 100)}%</span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => adjustNameScale(-0.08)}
                              aria-label="Reduce name text size"
                              className="min-w-[38px] min-h-[34px] rounded-lg bg-[#f7f1e1] hover:bg-[#e5dcc8] active:bg-[#d5c9b1] text-[#3d0613] flex items-center justify-center cursor-pointer border border-[#d5c9b1]"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => adjustNameScale(0.08)}
                              aria-label="Increase name text size"
                              className="min-w-[38px] min-h-[34px] rounded-lg bg-[#f7f1e1] hover:bg-[#e5dcc8] active:bg-[#d5c9b1] text-[#3d0613] flex items-center justify-center cursor-pointer border border-[#d5c9b1]"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={0.5}
                          max={1.3}
                          step={0.02}
                          value={adjustments.nameScale}
                          onChange={(e) => {
                            setAdjustments((prev) => ({
                              ...prev,
                              nameScale: parseFloat(e.target.value),
                            }));
                            setGeneratedPngUrl(null);
                          }}
                          aria-label="Name text size"
                          className="w-full"
                        />
                      </div>

                      {/* Location / Parish Text Size Control */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-bold text-[#3d0613]">
                          <span>
                            Location Size: {Math.round(adjustments.locationScale * 100)}%
                          </span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => adjustLocationScale(-0.08)}
                              aria-label="Reduce location text size"
                              className="min-w-[38px] min-h-[34px] rounded-lg bg-[#f7f1e1] hover:bg-[#e5dcc8] active:bg-[#d5c9b1] text-[#3d0613] flex items-center justify-center cursor-pointer border border-[#d5c9b1]"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => adjustLocationScale(0.08)}
                              aria-label="Increase location text size"
                              className="min-w-[38px] min-h-[34px] rounded-lg bg-[#f7f1e1] hover:bg-[#e5dcc8] active:bg-[#d5c9b1] text-[#3d0613] flex items-center justify-center cursor-pointer border border-[#d5c9b1]"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={0.5}
                          max={1.3}
                          step={0.02}
                          value={adjustments.locationScale}
                          onChange={(e) => {
                            setAdjustments((prev) => ({
                              ...prev,
                              locationScale: parseFloat(e.target.value),
                            }));
                            setGeneratedPngUrl(null);
                          }}
                          aria-label="Location or parish text size"
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Allow Beyond Border (Pop-Out Mode) Toggle */}
                  <div className="flex items-center justify-between gap-2 bg-[#fdfaf2] px-3.5 py-2.5 rounded-xl border border-[#e5dcc8]">
                    <div className="flex items-center gap-2 text-xs font-bold text-[#3d0613]">
                      <Layers className="w-4 h-4 text-[#680d22] shrink-0" />
                      <span>Extend Photo Beyond Border:</span>
                    </div>
                    <button
                      type="button"
                      disabled={!activeVisitorPhoto}
                      onClick={toggleOverflowMode}
                      className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer disabled:opacity-40 ${
                        adjustments.allowOverflow
                          ? "bg-[#680d22] text-[#f5b82e] shadow-xs"
                          : "bg-[#e5dcc8] text-[#3d0613]"
                      }`}
                    >
                      {adjustments.allowOverflow
                        ? "✓ Allowed Beyond Border"
                        : "Clipped Inside Border"}
                    </button>
                  </div>

                  {/* PHOTO ZOOM & DIRECTIONAL CONTROLS */}
                  <div className="bg-[#fdfaf2] p-3.5 sm:p-4 rounded-xl border border-[#e5dcc8] space-y-3.5">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-[#3d0613]">
                        <span>Photo Zoom: {Math.round(adjustments.zoom * 100)}%</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => adjustZoom(-0.1)}
                            disabled={!activeVisitorPhoto}
                            aria-label="Zoom out"
                            className="min-w-[42px] min-h-[38px] px-2.5 rounded-lg bg-[#f7f1e1] hover:bg-[#e5dcc8] active:bg-[#d5c9b1] text-[#3d0613] disabled:opacity-40 flex items-center justify-center cursor-pointer border border-[#d5c9b1]"
                          >
                            <ZoomOut className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => adjustZoom(0.1)}
                            disabled={!activeVisitorPhoto}
                            aria-label="Zoom in"
                            className="min-w-[42px] min-h-[38px] px-2.5 rounded-lg bg-[#f7f1e1] hover:bg-[#e5dcc8] active:bg-[#d5c9b1] text-[#3d0613] disabled:opacity-40 flex items-center justify-center cursor-pointer border border-[#d5c9b1]"
                          >
                            <ZoomIn className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <input
                        type="range"
                        min={0.4}
                        max={2.8}
                        step={0.02}
                        value={adjustments.zoom}
                        disabled={!activeVisitorPhoto}
                        onChange={(e) => {
                          setAdjustments((prev) => ({
                            ...prev,
                            zoom: parseFloat(e.target.value),
                          }));
                          setGeneratedPngUrl(null);
                        }}
                        aria-label="Zoom level"
                        className="w-full"
                      />
                    </div>

                    {/* Touch-Friendly Directional Buttons + Sliders */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2 border-t border-[#e5dcc8]/70">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-bold text-[#5a2230]">
                          <span>Move Left / Right</span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => adjustPan(-6, 0)}
                              disabled={!activeVisitorPhoto}
                              aria-label="Move photo left"
                              className="min-w-[42px] min-h-[36px] rounded-lg bg-[#f7f1e1] hover:bg-[#e5dcc8] active:bg-[#d5c9b1] text-[#3d0613] disabled:opacity-40 flex items-center justify-center cursor-pointer border border-[#d5c9b1]"
                            >
                              <ArrowLeft className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => adjustPan(6, 0)}
                              disabled={!activeVisitorPhoto}
                              aria-label="Move photo right"
                              className="min-w-[42px] min-h-[36px] rounded-lg bg-[#f7f1e1] hover:bg-[#e5dcc8] active:bg-[#d5c9b1] text-[#3d0613] disabled:opacity-40 flex items-center justify-center cursor-pointer border border-[#d5c9b1]"
                            >
                              <ArrowRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={-100}
                          max={100}
                          step={1}
                          value={adjustments.offsetX}
                          disabled={!activeVisitorPhoto}
                          onChange={(e) => {
                            setAdjustments((prev) => ({
                              ...prev,
                              offsetX: parseInt(e.target.value, 10),
                            }));
                            setGeneratedPngUrl(null);
                          }}
                          aria-label="Move photo left or right"
                          className="w-full"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-bold text-[#5a2230]">
                          <span>Move Up / Down</span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => adjustPan(0, -6)}
                              disabled={!activeVisitorPhoto}
                              aria-label="Move photo up"
                              className="min-w-[42px] min-h-[36px] rounded-lg bg-[#f7f1e1] hover:bg-[#e5dcc8] active:bg-[#d5c9b1] text-[#3d0613] disabled:opacity-40 flex items-center justify-center cursor-pointer border border-[#d5c9b1]"
                            >
                              <ArrowUp className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => adjustPan(0, 6)}
                              disabled={!activeVisitorPhoto}
                              aria-label="Move photo down"
                              className="min-w-[42px] min-h-[36px] rounded-lg bg-[#f7f1e1] hover:bg-[#e5dcc8] active:bg-[#d5c9b1] text-[#3d0613] disabled:opacity-40 flex items-center justify-center cursor-pointer border border-[#d5c9b1]"
                            >
                              <ArrowDown className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={-100}
                          max={100}
                          step={1}
                          value={adjustments.offsetY}
                          disabled={!activeVisitorPhoto}
                          onChange={(e) => {
                            setAdjustments((prev) => ({
                              ...prev,
                              offsetY: parseInt(e.target.value, 10),
                            }));
                            setGeneratedPngUrl(null);
                          }}
                          aria-label="Move photo up or down"
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Validation Error Banner */}
                {formError && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-xl bg-red-50 border border-red-300 text-red-800 text-xs sm:text-sm font-medium flex items-start gap-2.5"
                  >
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* STEP 4: GENERATE / PREVIEW BUTTON */}
                <button
                  type="button"
                  onClick={handleGeneratePoster}
                  disabled={isGenerating || isRemovingBg}
                  className="w-full min-h-[54px] py-4 px-6 rounded-xl bg-[#680d22] hover:bg-[#480816] active:scale-[0.99] text-[#f5b82e] font-extrabold text-base sm:text-lg shadow-lg transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-5 h-5 shrink-0" />
                  <span>
                    {isRemovingBg
                      ? "Finishing Background Cutout..."
                      : isGenerating
                      ? "Generating High-Res Poster..."
                      : "Generate & Preview My Poster"}
                  </span>
                </button>

                {/* SECTION 7: PRIVACY NOTICE */}
                <div className="p-3 rounded-xl bg-[#fdfaf2] border border-[#e5dcc8] flex items-start gap-2.5 text-[11px] sm:text-xs text-[#5a2230]">
                  <ShieldCheck className="w-4 h-4 text-[#680d22] shrink-0 mt-0.5" />
                  <p>{EVENT_DATA.privacyNotice}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5.4 & 5.5 COMPLETED POSTER PREVIEW, DOWNLOAD & SHARING SECTION */}
        {generatedPngUrl && (
          <section
            id="poster-preview"
            ref={previewSectionRef}
            className="py-10 sm:py-16 bg-gradient-to-b from-[#3d0613] to-[#580b1d] text-[#fdfaf2] border-t-4 border-[#f5b82e] scroll-mt-14"
          >
            <div className="max-w-5xl mx-auto px-4 sm:px-6 space-y-6 sm:space-y-8">
              <div className="text-center max-w-2xl mx-auto space-y-1.5">
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-bold uppercase tracking-wider">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Your Personalised Poster Is Ready!</span>
                </span>
                <h2
                  className="text-2xl sm:text-4xl font-extrabold text-white"
                  style={{ fontFamily: "var(--font-oswald)" }}
                >
                  DOWNLOAD &amp; SHARE YOUR POSTER
                </h2>
                <p className="text-xs sm:text-base text-[#f7f1e1]/85">
                  Tap <strong>Download Poster</strong> below (or long-press the poster image on
                  your phone to save to Photos), then share on WhatsApp!
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center">
                {/* Completed Artwork Image Preview */}
                <div className="lg:col-span-6 flex justify-center">
                  <div className="w-full max-w-[300px] sm:max-w-sm rounded-2xl p-2 bg-gradient-to-b from-[#f5b82e] to-[#c98812] shadow-2xl">
                    <img
                      src={generatedPngUrl}
                      alt={`Personalised Harvest Attendance Poster for ${visitorName}`}
                      width={MASTER_WIDTH}
                      height={MASTER_HEIGHT}
                      className="w-full h-auto rounded-xl block"
                    />
                  </div>
                </div>

                {/* Download, Share & Edit Actions */}
                <div className="lg:col-span-6 space-y-4 bg-white/10 backdrop-blur-sm p-5 sm:p-8 rounded-2xl border border-white/15">
                  <h3 className="text-lg sm:text-xl font-bold text-[#f5b82e]">
                    Save to Phone &amp; Invite Friends
                  </h3>
                  <p className="text-xs sm:text-sm text-[#f7f1e1]/90 leading-relaxed">
                    Exported at full master quality ({MASTER_WIDTH} × {MASTER_HEIGHT} px PNG).
                  </p>

                  <div className="space-y-3 pt-1">
                    <button
                      type="button"
                      onClick={handleDownloadPoster}
                      className="w-full min-h-[54px] py-3.5 px-6 rounded-xl bg-[#f5b82e] hover:bg-[#ffca4b] active:scale-[0.99] text-[#3d0613] font-extrabold text-base sm:text-lg shadow-lg transition-all flex items-center justify-center gap-2.5 cursor-pointer"
                    >
                      <Download className="w-5 h-5 shrink-0" />
                      <span>Download Poster (PNG)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleWhatsAppShare}
                      className="w-full min-h-[52px] py-3.5 px-6 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] active:scale-[0.99] text-[#0b2e18] font-extrabold text-base shadow-md transition-all flex items-center justify-center gap-2.5 cursor-pointer"
                    >
                      <MessageCircle className="w-5 h-5 shrink-0" />
                      <span>Share on WhatsApp</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSharePoster}
                      className="w-full min-h-[48px] py-3 px-6 rounded-xl bg-white/15 hover:bg-white/25 text-white font-bold text-sm sm:text-base border border-white/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Share2 className="w-4 h-4 text-[#f5b82e] shrink-0" />
                      <span>Share Poster to Other Apps</span>
                    </button>
                  </div>

                  {shareStatusMessage && (
                    <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-xs sm:text-sm font-medium">
                      {shareStatusMessage}
                    </div>
                  )}

                  {showWhatsappFallbackNote && (
                    <div className="p-3.5 rounded-xl bg-black/40 border border-[#f5b82e]/50 space-y-2 text-xs sm:text-sm text-[#f7f1e1]">
                      <p className="font-bold text-[#f5b82e]">
                        How to share your poster image on WhatsApp:
                      </p>
                      <ol className="list-decimal list-inside space-y-1 text-[#f7f1e1]/90">
                        <li>
                          Tap <strong>&ldquo;Download Poster (PNG)&rdquo;</strong> above to save
                          the image to your phone gallery.
                        </li>
                        <li>
                          In WhatsApp, tap the <strong>Attach / Photos (+)</strong> icon and
                          select your saved poster image.
                        </li>
                      </ol>
                      <div className="pt-1">
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(
                            EVENT_DATA.whatsappShareMessage
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-[#25D366] underline"
                        >
                          <span>Open WhatsApp with invitation message →</span>
                        </a>
                      </div>
                    </div>
                  )}

                  <div className="pt-3 border-t border-white/15 grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={handleReturnToEdit}
                      className="min-h-[46px] py-2.5 px-3 rounded-xl border border-white/25 hover:bg-white/10 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4 text-[#f5b82e] shrink-0" />
                      <span>Edit Poster</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCreateAnotherPoster}
                      className="min-h-[46px] py-2.5 px-3 rounded-xl border border-[#f5b82e]/40 hover:bg-[#f5b82e]/15 text-[#f5b82e] font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4 shrink-0" />
                      <span>Create Another</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 5.2 EVENT INFORMATION SECTION */}
        <section
          id="event-info"
          className="py-10 sm:py-16 bg-[#f7f1e1] border-t border-b border-[#e5dcc8] scroll-mt-14"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8 sm:space-y-10">
            <div className="text-center max-w-3xl mx-auto space-y-2">
              <p className="text-xs sm:text-sm font-bold uppercase tracking-widest text-[#85142e]">
                {EVENT_DATA.churchName} ({EVENT_DATA.ministryIdentity})
              </p>
              <h2
                className="text-2xl sm:text-4xl font-extrabold text-[#3d0613]"
                style={{ fontFamily: "var(--font-oswald)" }}
              >
                {EVENT_DATA.eventTitle.toUpperCase()} — PROGRAMME SCHEDULE
              </h2>
              <p className="text-sm sm:text-base text-[#5a2230] font-medium">
                Theme: <span className="font-bold text-[#680d22]">{EVENT_DATA.theme}</span>
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              {EVENT_DATA.programmes.map((prog, index) => (
                <div
                  key={prog.id}
                  className="bg-[#fdfaf2] rounded-2xl p-5 sm:p-8 border-2 border-[#e5dcc8] shadow-sm flex flex-col justify-between"
                >
                  <div className="space-y-3 sm:space-y-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="inline-block px-3 py-1 rounded-full text-[11px] sm:text-xs font-bold uppercase tracking-wider bg-[#680d22] text-[#f5b82e]">
                        Programme {index + 1} • {prog.category}
                      </span>
                      {prog.edition && (
                        <span className="text-[11px] sm:text-xs font-bold uppercase px-2.5 py-1 rounded-md bg-[#f5b82e]/25 text-[#480816]">
                          {prog.edition}
                        </span>
                      )}
                    </div>

                    <h3
                      className="text-xl sm:text-3xl font-extrabold text-[#480816] tracking-wide uppercase"
                      style={{ fontFamily: "var(--font-oswald)" }}
                    >
                      {prog.title}
                    </h3>

                    <div className="space-y-2 pt-1 text-sm sm:text-base text-[#3b151e]">
                      <div className="flex items-center gap-2.5">
                        <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-[#85142e] shrink-0" />
                        <span className="font-bold">{prog.date}</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-[#85142e] shrink-0" />
                        <span className="font-semibold">{prog.time}</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <MapPin className="w-4 h-4 sm:w-5 sm:h-5 text-[#85142e] shrink-0" />
                        <span>
                          Venue: <strong>{prog.venue}</strong>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-[#480816] text-[#fdfaf2] rounded-2xl p-5 sm:p-8 shadow-md border border-[#f5b82e]/30">
              <div className="lg:col-span-5 space-y-3.5 border-b lg:border-b-0 lg:border-r border-white/15 pb-5 lg:pb-0 lg:pr-6">
                <h3 className="text-base sm:text-lg font-bold text-[#f5b82e] uppercase tracking-wider">
                  Church Location &amp; Contact
                </h3>
                <div className="space-y-2.5 text-sm sm:text-base">
                  <p className="flex items-start gap-2.5">
                    <MapPin className="w-5 h-5 text-[#f5b82e] shrink-0 mt-0.5" />
                    <span>{EVENT_DATA.address}</span>
                  </p>
                  <p className="flex items-center gap-2.5">
                    <Phone className="w-5 h-5 text-[#f5b82e] shrink-0" />
                    <span>
                      <a
                        href={`tel:${EVENT_DATA.telephones[0]}`}
                        className="underline hover:text-[#f5b82e] font-semibold"
                      >
                        {EVENT_DATA.telephones[0]}
                      </a>
                      {", "}
                      <a
                        href={`tel:${EVENT_DATA.telephones[1]}`}
                        className="underline hover:text-[#f5b82e] font-semibold"
                      >
                        {EVENT_DATA.telephones[1]}
                      </a>
                    </span>
                  </p>
                  <div className="pt-1 flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="px-3 py-1.5 rounded-lg bg-white/10 text-[#f5b82e]">
                      FB / IG: {EVENT_DATA.socials.facebookInstagram}
                    </span>
                    <span className="px-3 py-1.5 rounded-lg bg-white/10 text-[#f5b82e]">
                      TikTok: {EVENT_DATA.socials.tiktok}
                    </span>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 space-y-3">
                <h3 className="text-base sm:text-lg font-bold text-[#f5b82e] uppercase tracking-wider">
                  Featuring Guest Ministers &amp; Host
                </h3>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {EVENT_DATA.guestMinisters.map((minister) => (
                    <span
                      key={minister.name}
                      className={`px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold border ${
                        minister.role.includes("Host")
                          ? "bg-[#f5b82e] text-[#3d0613] border-[#f5b82e] font-bold"
                          : "bg-white/10 text-white border-white/15"
                      }`}
                    >
                      {minister.name}
                      {minister.role.includes("Host") ? " (Host / Shepherd)" : ""}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER WITH OFFICIAL LOGO */}
      <footer className="bg-[#2c040d] text-[#f7f1e1]/80 py-8 sm:py-10 border-t border-[#f5b82e]/25 text-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="bg-[#fdfaf2] px-3 py-1.5 rounded-xl border border-[#f5b82e]">
              <img
                src="/logo.png"
                alt="His Mercy Parish Logo"
                className="h-10 w-auto object-contain"
              />
            </div>
            <div className="space-y-1">
              <p className="font-bold text-white">
                {EVENT_DATA.churchName} ({EVENT_DATA.ministryIdentity})
              </p>
              <p className="text-xs text-[#f7f1e1]/70">{EVENT_DATA.address}</p>
              <p className="text-xs text-[#f5b82e]">
                Tel: {EVENT_DATA.telephones.join(", ")} • {EVENT_DATA.socials.facebookInstagram}
              </p>
            </div>
          </div>
          <div className="max-w-md text-xs text-[#f7f1e1]/65 space-y-1">
            <p>{EVENT_DATA.privacyNotice}</p>
            <p className="text-[#f5b82e]/80 font-medium">
              {EVENT_DATA.eventTitle} — &ldquo;{EVENT_DATA.theme}&rdquo;
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
