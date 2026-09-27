const fs = require('fs');

const logoDeepB64 = fs.readFileSync('/tmp/logo-deep.b64', 'utf8');
const screenshot1B64 = fs.readFileSync('/tmp/screenshot1.b64', 'utf8');
const qrCodeJs = fs.readFileSync('artifacts/uc-companion/server/templates/qrcode.min.js', 'utf8');

const htmlContent = `<!doctype html>
<html lang="en">
  <head>
    <title>APP_NAME_PLACEHOLDER</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg width='180' height='180' viewBox='0 0 180 180' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='180' height='180' rx='36' fill='%23005d8f'/%3E%3C/svg%3E" />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@600;700;800&family=Nunito+Sans:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      :root {
        --uc-sky-blue: #52b6dc;
        --uc-deep-ocean: #005d8f;
        --uc-onyx-black: #1a1a1a;
        --uc-white: #ffffff;
        --uc-gray: #f5f7f9;
        --uc-text-muted: #4a5568;
      }
      * {
        box-sizing: border-box;
      }
      body {
        font-family: 'Nunito Sans', sans-serif;
        margin: 0;
        padding: 0;
        background-color: var(--uc-white);
        color: var(--uc-onyx-black);
        line-height: 1.5;
        min-height: 100vh;
        overflow-x: hidden;
      }
      h1, h2, h3, .brand-font {
        font-family: 'Barlow', sans-serif;
      }
      
      /* Base Layout */
      .page-wrapper {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }
      
      .hero-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 40px 24px;
        position: relative;
        overflow: hidden;
      }
      
      /* Subtle background shape */
      .hero-section::before {
        content: '';
        position: absolute;
        top: -10%;
        right: -10%;
        width: 60%;
        height: 120%;
        background: linear-gradient(135deg, rgba(82,182,220,0.1) 0%, rgba(0,93,143,0.05) 100%);
        border-radius: 50%;
        z-index: 0;
        pointer-events: none;
      }
      
      .container {
        max-width: 1200px;
        margin: 0 auto;
        width: 100%;
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 48px;
        align-items: center;
      }
      
      @media (min-width: 992px) {
        .hero-section {
          justify-content: center;
          padding: 80px 48px;
        }
        .container {
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
          gap: 64px;
        }
      }
      
      /* Left Content */
      .content-column {
        flex: 1;
        max-width: 540px;
        text-align: center;
      }
      @media (min-width: 992px) {
        .content-column {
          text-align: left;
        }
      }
      
      .brand-logo {
        width: 160px;
        margin-bottom: 32px;
      }
      
      h1 {
        font-size: 36px;
        line-height: 1.1;
        color: var(--uc-deep-ocean);
        margin: 0 0 16px 0;
        letter-spacing: -0.5px;
      }
      
      .subtitle {
        font-size: 18px;
        color: var(--uc-text-muted);
        margin: 0 0 40px 0;
        line-height: 1.6;
      }
      
      /* Dynamic Panels (Mobile fallback vs Desktop QR) */
      .interaction-panel {
        background: var(--uc-white);
        border: 1px solid rgba(0, 93, 143, 0.1);
        border-radius: 16px;
        padding: 32px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.04);
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        animation: fadeUp 0.6s ease-out forwards;
      }
      
      @media (min-width: 992px) {
        .interaction-panel {
          align-items: flex-start;
          text-align: left;
          flex-direction: row;
          gap: 24px;
        }
      }
      
      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      .qr-wrapper {
        background: white;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid rgba(0, 93, 143, 0.1);
        flex-shrink: 0;
        margin-bottom: 24px;
      }
      @media (min-width: 992px) {
        .qr-wrapper { margin-bottom: 0; }
      }
      
      .panel-text h2 {
        font-size: 20px;
        margin: 0 0 8px 0;
        color: var(--uc-onyx-black);
      }
      
      .panel-text p {
        font-size: 15px;
        color: var(--uc-text-muted);
        margin: 0 0 20px 0;
      }
      
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--uc-deep-ocean);
        color: var(--uc-white);
        padding: 14px 28px;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 700;
        font-family: 'Barlow', sans-serif;
        font-size: 16px;
        transition: all 0.2s ease;
        border: 2px solid transparent;
        cursor: pointer;
      }
      
      .btn:hover, .btn:focus-visible {
        background: #004b75;
        transform: translateY(-2px);
        box-shadow: 0 8px 16px rgba(0, 93, 143, 0.2);
        outline: none;
      }
      
      .btn:active {
        transform: translateY(0);
      }
      
      .btn-outline {
        background: transparent;
        color: var(--uc-deep-ocean);
        border-color: var(--uc-deep-ocean);
      }
      .btn-outline:hover, .btn-outline:focus-visible {
        background: rgba(0, 93, 143, 0.05);
        box-shadow: none;
      }
      
      /* Store buttons for mobile fallback */
      .store-buttons {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
        max-width: 280px;
      }
      .store-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 20px;
        background: var(--uc-gray);
        color: var(--uc-onyx-black);
        text-decoration: none;
        font-weight: 600;
        border-radius: 8px;
        transition: background 0.15s;
        width: 100%;
      }
      .store-link:hover {
        background: #e2e8f0;
      }
      .store-link svg {
        width: 20px;
        height: 20px;
      }
      
      /* Right Content - Mockup */
      .mockup-column {
        flex: 1;
        display: flex;
        justify-content: center;
        perspective: 1000px;
      }
      
      .phone-mockup {
        width: 280px;
        height: 570px;
        border-radius: 44px;
        border: 12px solid var(--uc-onyx-black);
        background: var(--uc-white);
        position: relative;
        box-shadow: 20px 30px 60px rgba(0,0,0,0.15), inset 0 0 0 2px rgba(255,255,255,0.2);
        overflow: hidden;
        transform: rotateY(-10deg) rotateX(5deg);
        transform-style: preserve-3d;
        animation: float 6s ease-in-out infinite;
      }
      
      .phone-mockup::before {
        content: '';
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 130px;
        height: 28px;
        background: var(--uc-onyx-black);
        border-bottom-left-radius: 18px;
        border-bottom-right-radius: 18px;
        z-index: 10;
      }
      
      .phone-mockup img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      
      @keyframes float {
        0%, 100% { transform: translateY(0) rotateY(-10deg) rotateX(5deg); }
        50% { transform: translateY(-16px) rotateY(-8deg) rotateX(7deg); }
      }
      
      /* States */
      .loading-overlay {
        position: fixed;
        inset: 0;
        background: var(--uc-white);
        z-index: 100;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transition: opacity 0.4s ease;
      }
      
      .spinner {
        width: 48px;
        height: 48px;
        border: 4px solid var(--uc-gray);
        border-top-color: var(--uc-sky-blue);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-bottom: 24px;
      }
      
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      
      .loading-text {
        font-family: 'Barlow', sans-serif;
        font-size: 20px;
        font-weight: 600;
        color: var(--uc-deep-ocean);
      }
      
      .hide { display: none !important; }
      
      /* Reduced Motion */
      @media (prefers-reduced-motion: reduce) {
        .interaction-panel, .phone-mockup, .spinner {
          animation: none !important;
          transform: none !important;
        }
      }
      
      /* Accessibility Focus */
      *:focus-visible {
        outline: 3px solid var(--uc-sky-blue);
        outline-offset: 4px;
      }
    </style>
  </head>
  <body>
    <!-- Redirecting state for mobile -->
    <div class="loading-overlay hide" id="loading">
      <div class="spinner"></div>
      <div class="loading-text">Opening in Expo Go...</div>
    </div>
    
    <div class="page-wrapper" id="content">
      <section class="hero-section">
        <div class="container">
          <div class="content-column">
            <img src="data:image/jpeg;base64,${logoDeepB64}" alt="Ultra Clear Logo" class="brand-logo" />
            
            <h1>APP_NAME_PLACEHOLDER</h1>
            <p class="subtitle">
              Manage your water filters, tests, orders, and support right from your phone. 
              The official companion app for Kenyan households.
            </p>
            
            <!-- Desktop / Default State -->
            <div class="interaction-panel" id="panel-desktop">
              <div class="qr-wrapper" id="qr-code"></div>
              <div class="panel-text">
                <h2>Scan to Preview</h2>
                <p>Use your phone's camera to open the app directly in Expo Go.</p>
                <a href="exps://EXPS_URL_PLACEHOLDER" class="btn btn-outline" id="btn-expo">Open in Expo Go</a>
              </div>
            </div>
            
            <!-- Mobile Fallback State (shown if deep link fails/needs manual interaction) -->
            <div class="interaction-panel hide" id="panel-mobile">
              <div class="panel-text" style="width: 100%;">
                <h2>Get Expo Go</h2>
                <p style="margin-bottom: 24px;">To run this app on your phone, you'll need the free Expo Go app installed first.</p>
                
                <div class="store-buttons" id="store-buttons">
                  <a id="app-store-btn" href="https://apps.apple.com/app/id982107779" class="store-link" target="_blank" rel="noopener noreferrer">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                    </svg>
                    App Store
                  </a>
                  <a id="play-store-btn" href="https://play.google.com/store/apps/details?id=host.exp.exponent" class="store-link" target="_blank" rel="noopener noreferrer">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"/>
                    </svg>
                    Google Play
                  </a>
                </div>
                <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid rgba(0,0,0,0.1);">
                  <p style="margin-bottom: 12px; font-size: 14px;">Already have Expo Go?</p>
                  <a href="exps://EXPS_URL_PLACEHOLDER" class="btn">Open App</a>
                </div>
              </div>
            </div>
            
          </div>
          
          <div class="mockup-column">
            <div class="phone-mockup">
              <img src="data:image/jpeg;base64,${screenshot1B64}" alt="Ultra Clear Companion App Screenshot" />
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Inline pure JS QR Code generator -->
    <script>
      ${qrCodeJs}
    </script>

    <script>
      (function () {
        const bundleStatusUrl = "BUNDLE_STATUS_URL_PLACEHOLDER";
        const bundlePollIntervalMs = 3000;
        let bundlePollTimer = null;
        let bundleCheckInFlight = false;

        function stopBundlePolling() {
          if (bundlePollTimer !== null) {
            clearInterval(bundlePollTimer);
            bundlePollTimer = null;
          }
        }

        async function checkForBundle() {
          if (document.hidden || bundleCheckInFlight) {
            return;
          }

          bundleCheckInFlight = true;
          try {
            const response = await fetch(bundleStatusUrl, {
              method: "HEAD",
              cache: "no-store",
            });
            if (response.status === 204) {
              stopBundlePolling();
              window.location.reload();
            }
          } catch {
            // Retries next poll
          } finally {
            bundleCheckInFlight = false;
          }
        }

        function startBundlePolling() {
          if (document.hidden || bundlePollTimer !== null) {
            return;
          }
          void checkForBundle();
          bundlePollTimer = setInterval(checkForBundle, bundlePollIntervalMs);
        }

        document.addEventListener("visibilitychange", function () {
          if (document.hidden) { stopBundlePolling(); } 
          else { startBundlePolling(); }
        });
        window.addEventListener("pagehide", stopBundlePolling);
        window.addEventListener("beforeunload", stopBundlePolling);
        startBundlePolling();

        const ua = navigator.userAgent;
        const loadingEl = document.getElementById("loading");
        const contentEl = document.getElementById("content");
        
        const panelDesktop = document.getElementById("panel-desktop");
        const panelMobile = document.getElementById("panel-mobile");

        const isAndroid = /Android/i.test(ua);
        const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        const isMobile = isAndroid || isIOS;

        const deepLink = "exps://EXPS_URL_PLACEHOLDER";
        
        // Generate QR code for desktop
        if (typeof QRCode !== 'undefined') {
          new QRCode(document.getElementById("qr-code"), {
            text: deepLink,
            width: 140,
            height: 140,
            colorDark : "#005d8f",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.M
          });
        }

        if (isMobile) {
          // Adjust store buttons based on platform
          const appStoreBtn = document.getElementById("app-store-btn");
          const playStoreBtn = document.getElementById("play-store-btn");
          const storeContainer = document.getElementById("store-buttons");
          
          if (isIOS) {
            playStoreBtn.style.display = "none";
          } else if (isAndroid) {
            appStoreBtn.style.display = "none";
          }
          
          // Switch to mobile panel structure
          panelDesktop.classList.add("hide");
          panelMobile.classList.remove("hide");

          if (isAndroid) {
            // Android visitors attempt deep link and show clear fallback to install Expo
            loadingEl.classList.remove("hide");
            contentEl.style.display = "none";
            
            // Attempt deep link
            window.location.href = deepLink;
            
            // If we are still here after 1500ms, the deep link failed (Expo Go not installed)
            setTimeout(function () {
              loadingEl.classList.add("hide");
              contentEl.style.display = "flex";
            }, 1500);
          }
        }
      })();
    </script>
  </body>
</html>`;

fs.writeFileSync('artifacts/uc-companion/server/templates/landing-page.html', htmlContent);
console.log('Done!');
