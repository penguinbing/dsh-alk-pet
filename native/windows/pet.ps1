Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$source = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;

public class PetForm : Form {
    // ------------------------------------------------------------------
    // Win32 interop
    // ------------------------------------------------------------------
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct SIZE {
        public int cx;
        public int cy;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct BLENDFUNCTION {
        public byte BlendOp;
        public byte BlendFlags;
        public byte SourceConstantAlpha;
        public byte AlphaFormat;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct BITMAPINFOHEADER {
        public uint biSize;
        public int biWidth;
        public int biHeight;
        public ushort biPlanes;
        public ushort biBitCount;
        public uint biCompression;
        public uint biSizeImage;
        public int biXPelsPerMeter;
        public int biYPelsPerMeter;
        public uint biClrUsed;
        public uint biClrImportant;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct BITMAPINFO {
        public BITMAPINFOHEADER bmiHeader;
        public uint bmiColors;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr hDC);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr hDC);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFO pbmi, uint usage, out IntPtr ppvBits, IntPtr hSection, uint offset);

    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize, IntPtr hdcSrc, ref POINT pptSrc, uint crKey, ref BLENDFUNCTION pblend, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForSystem();

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("shcore.dll")]
    private static extern int SetProcessDpiAwareness(int value);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------
    private const int WM_NCHITTEST = 0x0084;
    private const int WM_DPICHANGED = 0x02E0;
    private const int HTCLIENT = 1;
    private const int HTTRANSPARENT = -1;
    private const int WS_EX_LAYERED = 0x00080000;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const uint ULW_ALPHA = 0x00000002;
    private const byte AC_SRC_OVER = 0x00;
    private const byte AC_SRC_ALPHA = 0x01;
    private const int MAX_CHIPS_PER_ROW = 10;
    private const uint BI_RGB = 0;
    private const int IMAGE_CACHE_CAP = 160;
    private const float CHIP_SIZE = 20f;
    private const float CHIP_GAP = 6f;
    private const float CHIP_PAD_X = 7f;
    private const float CHIP_PAD_Y = 5f;
    private const float CHIP_ROW_GAP = 6f;
    private const float CHIP_RADIUS = 7f;
    private const float BUBBLE_RADIUS = 23f;
    private const float BUBBLE_MAX_WIDTH = 300f;
    private const float BUBBLE_MIN_WIDTH = 164f;
    private const float BUBBLE_TITLE_PAD = 45f;
    private const float BUBBLE_DETAIL_PAD = 34f;

    // ------------------------------------------------------------------
    // Persisted / injected state
    // ------------------------------------------------------------------
    private string assetDirectory;
    private JavaScriptSerializer json;
    private System.Windows.Forms.Timer animationTimer;
    private ToolTip chipToolTip;

    private string petState = "idle";
    private string title = "待机中";
    private string status = "待机中";
    private string detail = "待机中";
    private bool showBubble = true;
    private bool viewed = false;
    private bool reducedMotion = false;
    private int petSize = 120;
    private string selectedTaskId = "";
    private List<Dictionary<string, object>> tasks;
    private Dictionary<string, int> clips;
    private int frameMs = 83;
    private string assetVersion = ""; // parsed for protocol completeness; native rendering ignores it
    private string animationState = "idle";
    private int frameNumber = 1;

    // ------------------------------------------------------------------
    // DPI / layout
    // ------------------------------------------------------------------
    private float dpiScale = 1f;
    private float forcedDpiScale = 0f;
    private float sizeScale = 1f;
    private bool initialLayout = true;
    private int bubbleWidth = 0;
    private int bubbleHeight = 0;
    private int bubbleTop = 0;
    private int chipWidth = 0;
    private int chipHeight = 0;
    private int petTop = 0;
    private int petBoxWidth = 0;
    private int petBoxHeight = 0;
    private RectangleF chipContainerRect = RectangleF.Empty;
    private RectangleF[] chipRects = null;

    // ------------------------------------------------------------------
    // Fonts / drawing buffers
    // ------------------------------------------------------------------
    private Font titleFont;
    private Font detailFont;
    private Font questionFont;
    private Bitmap measureBitmap;
    private Graphics measureGraphics;
    private Bitmap renderBitmap;
    private byte[] premultiplied = null;
    private byte[] scanRow = null;
    private int bufferWidth = 0;
    private int bufferHeight = 0;
    private float bufferDpi = 0f;

    // ------------------------------------------------------------------
    // Image cache (LRU)
    // ------------------------------------------------------------------
    private Dictionary<string, Bitmap> imageCache;
    private List<string> imageOrder;

    // ------------------------------------------------------------------
    // Interaction
    // ------------------------------------------------------------------
    private Point? savedPosition = null;
    private Point? dragStartCursor = null;
    private Point dragStartLocation = Point.Empty;
    private bool dragging = false;
    private bool hoveringTasks = false;
    private int hoverChip = -1;
    private bool closing = false;
    private static bool noGetDpiForWindow = false;
    private static bool noGetDpiForSystem = false;

    // ------------------------------------------------------------------
    // Construction
    // ------------------------------------------------------------------
    public PetForm(string assetDirectory) {
        this.assetDirectory = assetDirectory;
        json = new JavaScriptSerializer();
        tasks = new List<Dictionary<string, object>>();
        imageCache = new Dictionary<string, Bitmap>();
        imageOrder = new List<string>();
        clips = new Dictionary<string, int>();
        FillDefaultClips(clips);

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        DoubleBuffered = true;
        ShowIcon = false;
        BackColor = Color.FromArgb(28, 34, 45);
        Width = 160;
        Height = 140;

        CreateFonts();
        LoadSavedPosition();

        MouseDown += OnPetMouseDown;
        MouseMove += OnPetMouseMove;
        MouseUp += OnPetMouseUp;
        MouseLeave += OnPetMouseLeave;
        FormClosing += OnPetFormClosing;

        chipToolTip = new ToolTip();
        chipToolTip.InitialDelay = 450;
        chipToolTip.ReshowDelay = 100;

        animationTimer = new System.Windows.Forms.Timer();
        animationTimer.Interval = frameMs;
        animationTimer.Tick += OnAnimationTick;
        animationTimer.Start();

        Thread thread = new Thread(ReadMessages);
        thread.IsBackground = true;
        thread.Start();
    }

    public static void SetupDpiAwareness() {
        try {
            if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return;
        } catch (Exception) {
        }
        try {
            if (SetProcessDpiAwareness(2) == 0) return;
        } catch (Exception) {
        }
        try {
            if (SetProcessDPIAware()) return;
        } catch (Exception) {
        }
    }

    protected override void OnPaintBackground(PaintEventArgs e) {
        // The whole UI is rendered into the layered-window bitmap; no GDI painting here.
    }

    protected override void OnPaint(PaintEventArgs e) {
        // The whole UI is rendered into the layered-window bitmap; no GDI painting here.
    }

    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            cp.ExStyle = cp.ExStyle | WS_EX_LAYERED | WS_EX_TOOLWINDOW;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        try {
            dpiScale = QueryDpi();
            CreateFonts();
            if (!savedPosition.HasValue) {
                Rectangle area = Screen.PrimaryScreen.WorkingArea;
                Location = new Point(area.Right - Px(184f * dpiScale), area.Bottom - Px(160f * dpiScale));
            }
            UpdateLayout(true);
            RenderFrame();
        } catch (Exception) {
        }
    }

    protected override void OnShown(EventArgs e) {
        base.OnShown(e);
        try {
            TopMost = true;
            RenderFrame();
        } catch (Exception) {
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e) {
        closing = true;
        DisposeResources();
        base.OnFormClosed(e);
    }

    // ------------------------------------------------------------------
    // DPI helpers
    // ------------------------------------------------------------------
    private static int Px(float value) {
        return (int)Math.Round(value);
    }

    private float QueryDpi() {
        if (IsHandleCreated && !noGetDpiForWindow) {
            try {
                uint dpi = GetDpiForWindow(Handle);
                if (dpi >= 72 && dpi <= 480) return dpi / 96f;
            } catch (Exception) {
                noGetDpiForWindow = true;
            }
        }
        if (!noGetDpiForSystem) {
            try {
                uint dpi = GetDpiForSystem();
                if (dpi >= 72 && dpi <= 480) return dpi / 96f;
            } catch (Exception) {
                noGetDpiForSystem = true;
            }
        }
        try {
            using (Graphics g = CreateGraphics()) {
                float dpi = g.DpiX;
                if (dpi >= 72 && dpi <= 480) return dpi / 96f;
            }
        } catch (Exception) {
        }
        return 1f;
    }

    private void CreateFonts() {
        DisposeFonts();
        try {
            FontFamily semibold = null;
            try {
                semibold = new FontFamily("Segoe UI Semibold");
            } catch (Exception) {
                semibold = null;
            }
            if (semibold != null) {
                titleFont = new Font(semibold, 10f, FontStyle.Regular, GraphicsUnit.Point);
            } else {
                titleFont = new Font("Segoe UI", 10f, FontStyle.Bold, GraphicsUnit.Point);
            }
            detailFont = new Font("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
            questionFont = new Font("Segoe UI", 12f * dpiScale, FontStyle.Bold, GraphicsUnit.Pixel);
        } catch (Exception) {
            titleFont = new Font(FontFamily.GenericSansSerif, 10f, FontStyle.Bold, GraphicsUnit.Point);
            detailFont = new Font(FontFamily.GenericSansSerif, 9.5f, FontStyle.Regular, GraphicsUnit.Point);
            questionFont = new Font(FontFamily.GenericSansSerif, 12f * dpiScale, FontStyle.Bold, GraphicsUnit.Pixel);
        }
        try {
            measureBitmap = new Bitmap(8, 8, PixelFormat.Format32bppArgb);
            measureBitmap.SetResolution(96f * dpiScale, 96f * dpiScale);
            measureGraphics = Graphics.FromImage(measureBitmap);
            measureGraphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        } catch (Exception) {
            measureGraphics = null;
        }
    }

    private void DisposeFonts() {
        try {
            if (measureGraphics != null) {
                measureGraphics.Dispose();
                measureGraphics = null;
            }
        } catch (Exception) {
        }
        try {
            if (measureBitmap != null) {
                measureBitmap.Dispose();
                measureBitmap = null;
            }
        } catch (Exception) {
        }
        try {
            if (titleFont != null) {
                titleFont.Dispose();
                titleFont = null;
            }
        } catch (Exception) {
        }
        try {
            if (detailFont != null) {
                detailFont.Dispose();
                detailFont = null;
            }
        } catch (Exception) {
        }
        try {
            if (questionFont != null) {
                questionFont.Dispose();
                questionFont = null;
            }
        } catch (Exception) {
        }
    }

    // ------------------------------------------------------------------
    // Message pump
    // ------------------------------------------------------------------
    private void ReadMessages() {
        // Dedicated parser instance: the reader thread and the UI thread must not
        // share the same JavaScriptSerializer instance.
        JavaScriptSerializer parser = new JavaScriptSerializer();
        try {
            string line;
            while ((line = Console.ReadLine()) != null) {
                Dictionary<string, object> data = null;
                try {
                    data = parser.DeserializeObject(line) as Dictionary<string, object>;
                } catch (Exception) {
                    data = null;
                }
                if (data == null) continue;
                Dictionary<string, object> captured = data;
                InvokeOnUi(new Action(delegate {
                    try {
                        ApplyMessage(captured);
                    } catch (Exception) {
                    }
                }));
            }
        } catch (Exception) {
        }
        InvokeOnUi(new Action(delegate {
            try {
                Close();
            } catch (Exception) {
            }
        }));
    }

    private void InvokeOnUi(Action action) {
        try {
            if (!IsHandleCreated) {
                for (int i = 0; i < 250 && !IsHandleCreated && !closing; i++) {
                    Thread.Sleep(20);
                }
            }
            if (!IsHandleCreated) return;
            BeginInvoke(action);
        } catch (Exception) {
        }
    }

    private void ApplyMessage(Dictionary<string, object> data) {
        if (data == null) return;
        object value;

        if (data.TryGetValue("state", out value) && value != null) {
            string next = Convert.ToString(value);
            if (!String.IsNullOrEmpty(next) && next != petState) {
                petState = next;
                animationState = next;
                frameNumber = 1;
            }
        }
        if (data.TryGetValue("title", out value)) title = value == null ? "当前任务" : Convert.ToString(value);
        if (data.TryGetValue("label", out value)) status = value == null ? "" : Convert.ToString(value);
        if (data.TryGetValue("detail", out value)) detail = value == null ? "" : Convert.ToString(value);
        if (data.TryGetValue("showBubble", out value) && value != null) showBubble = SafeBool(value, showBubble);
        if (data.TryGetValue("viewed", out value) && value != null) viewed = SafeBool(value, viewed);
        if (data.TryGetValue("reducedMotion", out value) && value != null) reducedMotion = SafeBool(value, reducedMotion);
        if (data.TryGetValue("size", out value) && value != null) {
            int nextSize = SafeInt(value, petSize);
            if (nextSize < 72) nextSize = 72;
            if (nextSize > 200) nextSize = 200;
            petSize = nextSize;
        }
        if (data.TryGetValue("selectedTaskId", out value)) selectedTaskId = value == null ? "" : Convert.ToString(value);
        if (data.TryGetValue("tasks", out value)) {
            tasks.Clear();
            // JavaScriptSerializer can surface JSON arrays as object[] or ArrayList
            // depending on the .NET runtime; accept any IList.
            System.Collections.IList items = value as System.Collections.IList;
            if (items != null) {
                for (int i = 0; i < items.Count; i++) {
                    System.Collections.IDictionary rawTask = items[i] as System.Collections.IDictionary;
                    if (rawTask == null) continue;
                    Dictionary<string, object> task = rawTask as Dictionary<string, object>;
                    if (task == null) {
                        task = new Dictionary<string, object>();
                        foreach (System.Collections.DictionaryEntry entry in rawTask) {
                            task[Convert.ToString(entry.Key)] = entry.Value;
                        }
                    }
                    tasks.Add(task);
                }
            }
            if (tasks.Count < 2) {
                hoverChip = -1;
                SetHover(false);
            } else if (hoverChip >= tasks.Count) {
                hoverChip = -1;
            }
        }
        if (data.TryGetValue("clips", out value) && value != null) {
            Dictionary<string, object> map = value as Dictionary<string, object>;
            if (map != null) clips = ParseClips(map);
        }
        if (data.TryGetValue("frameMs", out value) && value != null) {
            int nextMs = SafeInt(value, frameMs);
            if (nextMs >= 16 && nextMs <= 1000) {
                frameMs = nextMs;
                if (animationTimer != null) animationTimer.Interval = frameMs;
            }
        }
        if (data.TryGetValue("assetVersion", out value) && value != null) {
            // Browsers use this to bust HTTP caches. The native helper ignores it.
            assetVersion = Convert.ToString(value);
        }

        UpdateLayout(false);
        RenderFrame();
    }

    private static Dictionary<string, int> ParseClips(Dictionary<string, object> map) {
        Dictionary<string, int> next = new Dictionary<string, int>();
        FillDefaultClips(next);
        string[] keys = new string[] { "idle", "thinking", "working", "waiting", "success", "error" };
        for (int i = 0; i < keys.Length; i++) {
            object raw;
            if (map.TryGetValue(keys[i], out raw) && raw != null) {
                int count = SafeInt(raw, -1);
                if (count > 0 && count <= 100000) next[keys[i]] = count;
            }
        }
        return next;
    }

    private static void FillDefaultClips(Dictionary<string, int> map) {
        map["idle"] = 121;
        map["thinking"] = 121;
        map["working"] = 121;
        map["waiting"] = 121;
        map["success"] = 121;
        map["error"] = 59;
    }

    private static int SafeInt(object value, int fallback) {
        try {
            if (value is int) return (int)value;
            return Convert.ToInt32(value);
        } catch (Exception) {
            return fallback;
        }
    }

    private static bool SafeBool(object value, bool fallback) {
        try {
            if (value is bool) return (bool)value;
            return Convert.ToBoolean(value);
        } catch (Exception) {
            return fallback;
        }
    }

    private void OnAnimationTick(object sender, EventArgs e) {
        if (closing || reducedMotion) return;
        int count;
        if (!clips.TryGetValue(animationState, out count) || count < 1) count = 1;
        if (frameNumber < count) {
            frameNumber++;
        } else {
            frameNumber = 1;
            if (animationState == "success" || animationState == "error") animationState = "idle";
        }
        RenderFrame();
    }

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------
    private bool BubbleVisible {
        get {
            return showBubble && petState != "idle" && !viewed;
        }
    }

    private string BubbleDetailText() {
        if (String.IsNullOrWhiteSpace(detail) || detail == title) return status;
        return detail;
    }

    private Rectangle CurrentWorkingArea() {
        try {
            Point center = new Point(Left + Width / 2, Top + Height / 2);
            Screen screen = Screen.FromPoint(center);
            if (screen != null) return screen.WorkingArea;
        } catch (Exception) {
        }
        try {
            if (Screen.PrimaryScreen != null) return Screen.PrimaryScreen.WorkingArea;
        } catch (Exception) {
        }
        return new Rectangle(0, 0, 1024, 768);
    }

    private void UpdateLayout(bool resetPosition) {
        try {
            float newDpi = forcedDpiScale > 0f ? forcedDpiScale : QueryDpi();
            forcedDpiScale = 0f;
            if (Math.Abs(newDpi - dpiScale) > 0.001f) {
                dpiScale = newDpi;
                CreateFonts();
            }
        } catch (Exception) {
        }
        float u = dpiScale;
        sizeScale = petSize / 120f;

        Rectangle area = CurrentWorkingArea();
        int maxWindowWidth = Math.Max(80, area.Width - Px(16f * u));

        petBoxWidth = Math.Max(1, Px(160f * sizeScale * u));
        petBoxHeight = Math.Max(1, Px(140f * sizeScale * u));

        int maxBubbleWidth = Math.Max(Px(120f * u), Math.Min(Px(BUBBLE_MAX_WIDTH * u), area.Width - Px(24f * u)));
        int minBubbleWidth = Math.Min(maxBubbleWidth, Px(BUBBLE_MIN_WIDTH * u));
        int titlePad = Px(BUBBLE_TITLE_PAD * u);
        int detailPad = Px(BUBBLE_DETAIL_PAD * u);
        bool bubbleVisible = BubbleVisible;

        int widestTaskWidth = minBubbleWidth;
        if (tasks.Count > 1) {
            for (int i = 0; i < tasks.Count; i++) {
                int taskWidth = BubbleTaskWidth(tasks[i], titlePad, detailPad);
                if (taskWidth > widestTaskWidth) widestTaskWidth = taskWidth;
            }
        }
        if (widestTaskWidth > maxBubbleWidth) widestTaskWidth = maxBubbleWidth;
        if (widestTaskWidth < minBubbleWidth) widestTaskWidth = minBubbleWidth;

        if (bubbleVisible) {
            string stepText = BubbleDetailText();
            int natural = Px(MeasureText(title, titleFont)) + titlePad;
            int naturalStep = Px(MeasureText(stepText, detailFont)) + detailPad;
            if (naturalStep > natural) natural = naturalStep;
            if (tasks.Count > 1) {
                int hoveredIndex = hoveringTasks ? SelectedTaskIndex() : -1;
                if (hoveredIndex >= 0) {
                    bubbleWidth = Math.Min(maxBubbleWidth, Math.Max(minBubbleWidth, BubbleTaskWidth(tasks[hoveredIndex], titlePad, detailPad)));
                } else {
                    bubbleWidth = widestTaskWidth;
                }
            } else {
                bubbleWidth = Math.Min(maxBubbleWidth, Math.Max(minBubbleWidth, natural));
            }
            int titleLine = LineHeight(titleFont);
            int detailLine = LineHeight(detailFont);
            int padTop = Px(7f * u);
            int gap = Px(3f * u);
            int padBottom = Px(8f * u);
            bubbleHeight = Math.Max(1, padTop + titleLine + gap + detailLine + padBottom);
        } else {
            bubbleWidth = 0;
            bubbleHeight = 0;
        }

        // Floating dots keep the original look: 18px circles on a 23px pitch, 12 per row.
        int dot = Math.Max(1, Px(18f * u));
        int pitch = Math.Max(dot + 1, Px(23f * u));
        int dotTop = Math.Max(0, Px(5f * u));
        int sidePadding = Px(12f * u);
        int bottomPadding = Px(10f * u);
        chipWidth = 0;
        chipHeight = 0;
        chipRects = null;
        chipContainerRect = RectangleF.Empty;

        int chipCount = tasks.Count > 1 ? tasks.Count : 0;
        if (chipCount > 0) {
            int rows = (chipCount + MAX_CHIPS_PER_ROW - 1) / MAX_CHIPS_PER_ROW;
            int columns = Math.Min(MAX_CHIPS_PER_ROW, chipCount);
            chipWidth = Math.Max(1, columns * pitch + sidePadding);
            chipHeight = Math.Max(1, rows * pitch + bottomPadding);
            chipRects = new RectangleF[chipCount];
        }

        int contentWidth = Math.Max(petBoxWidth, Math.Max(chipWidth, Math.Max(bubbleWidth, tasks.Count > 1 ? widestTaskWidth : 0)));
        if (contentWidth > maxWindowWidth) contentWidth = maxWindowWidth;
        if (bubbleWidth > contentWidth) bubbleWidth = contentWidth;

        int bubbleGap = bubbleVisible ? Px(5f * u) : 0;
        if (bubbleVisible) {
            bubbleTop = chipHeight;
            petTop = bubbleTop + bubbleHeight + bubbleGap;
        } else {
            bubbleTop = 0;
            petTop = chipHeight;
        }
        int contentHeight = Math.Max(1, petTop + petBoxHeight);

        if (chipRects != null) {
            for (int i = 0; i < chipRects.Length; i++) {
                int row = i / MAX_CHIPS_PER_ROW;
                int column = i % MAX_CHIPS_PER_ROW;
                int inRow = Math.Min(MAX_CHIPS_PER_ROW, chipCount - row * MAX_CHIPS_PER_ROW);
                float dotStartX = (contentWidth - (inRow * pitch - (pitch - dot))) / 2f;
                chipRects[i] = new RectangleF(dotStartX + column * pitch, dotTop + row * pitch, dot, dot);
            }
        }

        int oldWidth = Width;
        int oldHeight = Height;
        int oldX = Left;
        int oldY = Top;
        int oldCenterX = oldX + oldWidth / 2;
        int oldBottom = oldY + oldHeight;
        Size nextSize = new Size(Math.Max(1, contentWidth), Math.Max(1, contentHeight));
        Size = nextSize;

        if (resetPosition || initialLayout) {
            initialLayout = false;
            int maxX = area.Right - nextSize.Width;
            int maxY = area.Bottom - nextSize.Height;
            if (maxX < area.Left) maxX = area.Left;
            if (maxY < area.Top) maxY = area.Top;
            Location = new Point(Math.Max(area.Left, Math.Min(oldX, maxX)), Math.Max(area.Top, Math.Min(oldY, maxY)));
        } else {
            int nextX = oldCenterX - nextSize.Width / 2;
            int nextY = oldBottom - nextSize.Height;
            int maxX = area.Right - nextSize.Width;
            int maxY = area.Bottom - nextSize.Height;
            if (maxX < area.Left) maxX = area.Left;
            if (maxY < area.Top) maxY = area.Top;
            Location = new Point(Math.Max(area.Left, Math.Min(nextX, maxX)), Math.Max(area.Top, Math.Min(nextY, maxY)));
        }
    }

    // Radius of the individual chips in device pixels, refreshed by UpdateLayout.
    private int csharpChipRadius = 7;

    private int LineHeight(Font font) {
        if (font == null) return 1;
        try {
            if (measureGraphics != null) return Math.Max(1, (int)Math.Ceiling(font.GetHeight(measureGraphics)));
            return Math.Max(1, (int)Math.Ceiling(font.Size * 96f / 72f * dpiScale));
        } catch (Exception) {
            return Math.Max(1, (int)Math.Ceiling(12f * dpiScale));
        }
    }

    private float MeasureText(string text, Font font) {
        if (String.IsNullOrEmpty(text) || font == null) return 0f;
        try {
            if (measureGraphics != null) {
                SizeF measured = measureGraphics.MeasureString(text, font, new PointF(0f, 0f), StringFormat.GenericTypographic);
                return measured.Width;
            }
        } catch (Exception) {
        }
        return text.Length * font.Size * 0.62f;
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------
    private void RenderFrame() {
        if (closing || !IsHandleCreated) return;
        int width = ClientSize.Width;
        int height = ClientSize.Height;
        if (width <= 0 || height <= 0) return;
        EnsureBuffers(width, height);
        if (renderBitmap == null) return;
        try {
            using (Graphics g = Graphics.FromImage(renderBitmap)) {
                g.Clear(Color.Transparent);
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                DrawChipRail(g);
                DrawBubble(g);
                DrawPet(g);
            }
        } catch (Exception) {
        }
        PremultiplyBuffer();
        PushLayeredWindow();
    }

    private void EnsureBuffers(int width, int height) {
        if (renderBitmap != null && bufferWidth == width && bufferHeight == height && Math.Abs(bufferDpi - dpiScale) < 0.001f) return;
        DisposeBuffers();
        Bitmap bitmap = null;
        try {
            bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            bitmap.SetResolution(96f * dpiScale, 96f * dpiScale);
        } catch (Exception) {
            if (bitmap == null) {
                try {
                    bitmap = new Bitmap(width, height);
                } catch (Exception) {
                    bitmap = null;
                }
            }
        }
        if (bitmap == null) return;
        renderBitmap = bitmap;
        bufferWidth = width;
        bufferHeight = height;
        bufferDpi = dpiScale;
        premultiplied = new byte[width * height * 4];
        scanRow = null;
    }

    private void DisposeBuffers() {
        try {
            if (renderBitmap != null) {
                renderBitmap.Dispose();
                renderBitmap = null;
            }
        } catch (Exception) {
        }
        premultiplied = null;
        scanRow = null;
        bufferWidth = 0;
        bufferHeight = 0;
        bufferDpi = 0f;
    }

    private void PremultiplyBuffer() {
        if (renderBitmap == null || premultiplied == null) return;
        int width = bufferWidth;
        int height = bufferHeight;
        if (width <= 0 || height <= 0) return;
        int expected = width * height * 4;
        if (premultiplied.Length != expected) {
            premultiplied = new byte[expected];
        }
        BitmapData data = null;
        try {
            data = renderBitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            int stride = data.Stride;
            if (scanRow == null || scanRow.Length < stride) scanRow = new byte[stride];
            for (int y = 0; y < height; y++) {
                Marshal.Copy(IntPtr.Add(data.Scan0, y * stride), scanRow, 0, stride);
                int destination = y * width * 4;
                int source = 0;
                for (int x = 0; x < width; x++) {
                    byte blue = scanRow[source];
                    byte green = scanRow[source + 1];
                    byte red = scanRow[source + 2];
                    byte alpha = scanRow[source + 3];
                    if (alpha == 0) {
                        premultiplied[destination] = 0;
                        premultiplied[destination + 1] = 0;
                        premultiplied[destination + 2] = 0;
                        premultiplied[destination + 3] = 0;
                    } else if (alpha == 255) {
                        premultiplied[destination] = blue;
                        premultiplied[destination + 1] = green;
                        premultiplied[destination + 2] = red;
                        premultiplied[destination + 3] = 255;
                    } else {
                        premultiplied[destination] = (byte)((blue * alpha + 127) / 255);
                        premultiplied[destination + 1] = (byte)((green * alpha + 127) / 255);
                        premultiplied[destination + 2] = (byte)((red * alpha + 127) / 255);
                        premultiplied[destination + 3] = alpha;
                    }
                    destination += 4;
                    source += 4;
                }
            }
        } catch (Exception) {
        } finally {
            if (data != null && renderBitmap != null) {
                try {
                    renderBitmap.UnlockBits(data);
                } catch (Exception) {
                }
            }
        }
    }

    private void PushLayeredWindow() {
        if (premultiplied == null) return;
        int width = bufferWidth;
        int height = bufferHeight;
        if (width <= 0 || height <= 0) return;
        if (width > 8192 || height > 8192) return;
        IntPtr screenDc = IntPtr.Zero;
        IntPtr memoryDc = IntPtr.Zero;
        IntPtr dib = IntPtr.Zero;
        IntPtr previousObject = IntPtr.Zero;
        try {
            screenDc = GetDC(IntPtr.Zero);
            if (screenDc == IntPtr.Zero) return;
            memoryDc = CreateCompatibleDC(screenDc);
            if (memoryDc == IntPtr.Zero) return;
            BITMAPINFO info = new BITMAPINFO();
            info.bmiHeader.biSize = (uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER));
            info.bmiHeader.biWidth = width;
            info.bmiHeader.biHeight = -height;
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = BI_RGB;
            info.bmiHeader.biSizeImage = (uint)(width * height * 4);
            IntPtr bits;
            dib = CreateDIBSection(screenDc, ref info, 0, out bits, IntPtr.Zero, 0);
            if (dib == IntPtr.Zero || bits == IntPtr.Zero) return;
            Marshal.Copy(premultiplied, 0, bits, width * height * 4);
            previousObject = SelectObject(memoryDc, dib);
            POINT destination = new POINT();
            destination.X = Left;
            destination.Y = Top;
            SIZE size = new SIZE();
            size.cx = width;
            size.cy = height;
            POINT source = new POINT();
            source.X = 0;
            source.Y = 0;
            BLENDFUNCTION blend = new BLENDFUNCTION();
            blend.BlendOp = AC_SRC_OVER;
            blend.BlendFlags = 0;
            blend.SourceConstantAlpha = 255;
            blend.AlphaFormat = AC_SRC_ALPHA;
            UpdateLayeredWindow(Handle, screenDc, ref destination, ref size, memoryDc, ref source, 0, ref blend, ULW_ALPHA);
        } catch (Exception) {
        } finally {
            try {
                if (previousObject != IntPtr.Zero && memoryDc != IntPtr.Zero) SelectObject(memoryDc, previousObject);
            } catch (Exception) {
            }
            try {
                if (dib != IntPtr.Zero) DeleteObject(dib);
            } catch (Exception) {
            }
            try {
                if (memoryDc != IntPtr.Zero) DeleteDC(memoryDc);
            } catch (Exception) {
            }
            try {
                if (screenDc != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screenDc);
            } catch (Exception) {
            }
        }
    }

    // ------------------------------------------------------------------
    // Chip rail (shared spec)
    // ------------------------------------------------------------------
    private void DrawChipRail(Graphics g) {
        if (tasks.Count <= 1 || chipRects == null || chipHeight <= 0) return;
        int selectedIndex = SelectedTaskIndex();
        for (int i = 0; i < chipRects.Length; i++) {
            if (i == selectedIndex) continue;
            DrawChip(g, i, false);
        }
        if (selectedIndex >= 0) DrawChip(g, selectedIndex, true);
    }

    private void DrawChip(Graphics g, int index, bool selected) {
        if (index < 0 || index >= chipRects.Length) return;
        RectangleF rect = chipRects[index];
        string chipStatus = StatusOf(tasks[index]);
        float u = dpiScale;
        FillCircle(g, rect.X, rect.Y, rect.Width, ChipFillColor(chipStatus));
        DrawChipGlyph(g, chipStatus, rect);
        float borderWidth = Math.Max(1f, (selected ? 2f : 1f) * u);
        int borderAlpha = selected ? 255 : 100;
        using (Pen pen = new Pen(Color.FromArgb(borderAlpha, Color.White), borderWidth)) {
            g.DrawEllipse(pen, rect);
        }
    }

    private static Color ChipFillColor(string chipStatus) {
        if (chipStatus == "running") return Color.FromArgb(47, 158, 143);
        if (chipStatus == "waiting") return Color.FromArgb(184, 132, 47);
        if (chipStatus == "success") return Color.FromArgb(47, 156, 108);
        if (chipStatus == "error") return Color.FromArgb(198, 91, 104);
        return Color.FromArgb(93, 102, 117);
    }

    private void DrawChipGlyph(Graphics g, string chipStatus, RectangleF rect) {
        float box = 18f;
        float scale = rect.Width / box;
        float originX = rect.X + (rect.Width - box * scale) / 2f;
        float originY = rect.Y + (rect.Height - box * scale) / 2f;
        if (chipStatus == "idle") {
            float diameter = 6.5f * scale;
            using (Pen pen = new Pen(Color.FromArgb(184, 255, 255, 255), Math.Max(1f, 1.5f * scale))) {
                g.DrawEllipse(pen, rect.X + (rect.Width - diameter) / 2f, rect.Y + (rect.Height - diameter) / 2f, diameter, diameter);
            }
            return;
        }
        if (chipStatus == "running") {
            RectangleF square = new RectangleF(originX + 5.75f * scale, originY + 5.75f * scale, 6.5f * scale, 6.5f * scale);
            FillRoundedRect(g, square, Math.Max(1f, 1.1f * scale), Color.White);
            return;
        }
        if (chipStatus == "waiting") {
            using (Pen pen = new Pen(Color.White, Math.Max(1f, 1.9f * scale))) {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                pen.LineJoin = LineJoin.Round;
                using (GraphicsPath path = new GraphicsPath()) {
                    path.AddBezier(
                        new PointF(originX + 6.4f * scale, originY + 6.5f * scale),
                        new PointF(originX + 6.9f * scale, originY + 3.9f * scale),
                        new PointF(originX + 10.6f * scale, originY + 3.7f * scale),
                        new PointF(originX + 12.0f * scale, originY + 7.7f * scale));
                    path.AddBezier(
                        new PointF(originX + 12.0f * scale, originY + 7.7f * scale),
                        new PointF(originX + 12.0f * scale, originY + 9.2f * scale),
                        new PointF(originX + 11.0f * scale, originY + 9.7f * scale),
                        new PointF(originX + 10.0f * scale, originY + 10.6f * scale));
                    path.AddBezier(
                        new PointF(originX + 10.0f * scale, originY + 10.6f * scale),
                        new PointF(originX + 9.4f * scale, originY + 11.2f * scale),
                        new PointF(originX + 9.1f * scale, originY + 11.7f * scale),
                        new PointF(originX + 9.1f * scale, originY + 12.5f * scale));
                    g.DrawPath(pen, path);
                }
            }
            float dot = Math.Max(1f, 2.1f * scale);
            float centerX = originX + 9.1f * scale;
            float centerY = originY + 14.4f * scale;
            using (SolidBrush brush = new SolidBrush(Color.White)) {
                g.FillEllipse(brush, centerX - dot / 2f, centerY - dot / 2f, dot, dot);
            }
            return;
        }
        if (chipStatus == "success") {
            using (Pen pen = new Pen(Color.White, Math.Max(1f, 2.1f * scale))) {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                pen.LineJoin = LineJoin.Round;
                PointF[] points = new PointF[3];
                points[0] = new PointF(originX + 4.6f * scale, originY + 9.2f * scale);
                points[1] = new PointF(originX + 7.7f * scale, originY + 12.2f * scale);
                points[2] = new PointF(originX + 13.4f * scale, originY + 5.9f * scale);
                g.DrawLines(pen, points);
            }
            return;
        }
        if (chipStatus == "error") {
            using (Pen pen = new Pen(Color.White, Math.Max(1f, 2.1f * scale))) {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                g.DrawLine(pen, originX + 5.2f * scale, originY + 5.2f * scale, originX + 12.8f * scale, originY + 12.8f * scale);
                g.DrawLine(pen, originX + 12.8f * scale, originY + 5.2f * scale, originX + 5.2f * scale, originY + 12.8f * scale);
            }
        }
    }

    private void FillCircle(Graphics g, float x, float y, float diameter, Color color) {
        if (diameter <= 0f) return;
        using (SolidBrush brush = new SolidBrush(color)) {
            g.FillEllipse(brush, x, y, diameter, diameter);
        }
    }

    // ------------------------------------------------------------------
    // Bubble
    // ------------------------------------------------------------------
    private void DrawBubble(Graphics g) {
        if (!BubbleVisible || bubbleWidth <= 0 || bubbleHeight <= 0) return;
        float u = dpiScale;
        float x = (Width - bubbleWidth) / 2f;
        float y = bubbleTop;
        float radius = BUBBLE_RADIUS * u;
        for (int i = 3; i >= 1; i--) {
            RectangleF shadow = new RectangleF(x - i * 2f * u, y + (2f + i * 2f) * u, bubbleWidth + i * 4f * u, bubbleHeight);
            FillRoundedRect(g, shadow, radius + i * 2f * u, Color.FromArgb(12, 0, 0, 0));
        }
        RectangleF bubbleRect = new RectangleF(x, y, bubbleWidth, bubbleHeight);
        GraphicsPath bubblePath = RoundedPath(bubbleRect, radius);
        try {
            using (LinearGradientBrush brush = new LinearGradientBrush(new PointF(x, y), new PointF(x + bubbleWidth, y + bubbleHeight), Color.FromArgb(214, 48, 55, 70), Color.FromArgb(224, 30, 35, 47))) {
                g.FillPath(brush, bubblePath);
            }
            using (Pen border = new Pen(Color.FromArgb(56, 226, 237, 255), Math.Max(1f, u))) {
                g.DrawPath(border, bubblePath);
            }
            GraphicsState state = g.Save();
            try {
                g.SetClip(bubblePath, CombineMode.Replace);
                DrawBubbleContents(g, x, y, u);
            } finally {
                g.Restore(state);
            }
        } finally {
            bubblePath.Dispose();
        }
    }

    private void DrawBubbleContents(Graphics g, float x, float y, float u) {
        int padTop = Px(7f * u);
        int padLeft = Px(16f * u);
        int gap = Px(3f * u);
        int titleLine = LineHeight(titleFont);
        int detailLine = LineHeight(detailFont);
        float dotSize = 6f * u;
        float dotCenterX = x + padLeft + dotSize / 2f;
        float dotCenterY = y + padTop + titleLine / 2f;
        Color stateColor = StateColor();
        FillCircle(g, dotCenterX - dotSize / 2f, dotCenterY - dotSize / 2f, dotSize, stateColor);

        float titleX = x + padLeft + dotSize + 7f * u;
        float titleWidth = x + bubbleWidth - Px(14f * u) - titleX;
        if (titleWidth < 1f) titleWidth = 1f;
        DrawEllipsisText(g, title, titleFont, Color.White, new RectangleF(titleX, y + padTop, titleWidth, titleLine));

        float detailX = x + padLeft;
        float detailWidth = bubbleWidth - 2f * padLeft;
        if (detailWidth < 1f) detailWidth = 1f;
        DrawEllipsisText(g, BubbleDetailText(), detailFont, Color.FromArgb(190, 203, 220), new RectangleF(detailX, y + padTop + titleLine + gap, detailWidth, detailLine));
    }

    private void DrawEllipsisText(Graphics g, string text, Font font, Color color, RectangleF rect) {
        if (font == null || rect.Width <= 1f || rect.Height <= 0f) return;
        string value = text == null ? "" : text;
        if (value.Length == 0) return;
        using (SolidBrush brush = new SolidBrush(color)) {
            using (StringFormat format = new StringFormat()) {
                format.Trimming = StringTrimming.EllipsisCharacter;
                format.FormatFlags = StringFormatFlags.NoWrap;
                format.Alignment = StringAlignment.Near;
                format.LineAlignment = StringAlignment.Center;
                g.DrawString(value, font, brush, rect, format);
            }
        }
    }

    private Color StateColor() {
        if (petState == "thinking") return Color.FromArgb(173, 140, 255);
        if (petState == "working") return Color.FromArgb(89, 204, 178);
        if (petState == "waiting") return Color.FromArgb(255, 209, 122);
        if (petState == "success") return Color.FromArgb(133, 215, 141);
        if (petState == "error") return Color.FromArgb(255, 136, 142);
        return Color.FromArgb(121, 167, 255);
    }

    // ------------------------------------------------------------------
    // Pet
    // ------------------------------------------------------------------
    private void DrawPet(Graphics g) {
        if (petBoxWidth <= 0 || petBoxHeight <= 0) return;
        float u = dpiScale;
        int frame = reducedMotion ? 1 : frameNumber;
        if (frame < 1) frame = 1;
        Bitmap image = GetCachedImage(animationState, frame);
        // The pet cell is (152x140) * (size / 120); the source artwork keeps its aspect ratio.
        int cellWidth = Math.Max(1, Px(152f * sizeScale * u));
        int cellHeight = Math.Max(1, Px(140f * sizeScale * u));
        int imageWidth = cellWidth;
        int imageHeight = Math.Max(1, Px(cellWidth * 127f / 152f));
        if (image != null && image.Width > 0 && image.Height > 0) {
            imageHeight = Math.Max(1, Px(cellWidth * (float)image.Height / (float)image.Width));
            if (imageHeight > cellHeight) {
                imageHeight = cellHeight;
                imageWidth = Math.Max(1, Px(cellHeight * (float)image.Width / (float)image.Height));
            }
        }
        float petBoxX = (Width - petBoxWidth) / 2f;
        float cellX = petBoxX + (petBoxWidth - cellWidth) / 2f;
        float imageX = cellX + (cellWidth - imageWidth) / 2f;
        float imageY = petTop;
        if (image != null) {
            try {
                g.DrawImage(image, new RectangleF(imageX, imageY, imageWidth, imageHeight));
            } catch (Exception) {
            }
            return;
        }
        DrawFallbackPet(g, imageX, imageY, imageWidth, imageHeight);
    }

    private void DrawFallbackPet(Graphics g, float imageX, float imageY, float imageWidth, float imageHeight) {
        Color color = StateColor();
        float scaleX = imageWidth / 152f;
        float scaleY = imageHeight / 127f;
        if (scaleX <= 0f || scaleY <= 0f) return;
        GraphicsState state = g.Save();
        try {
            g.TranslateTransform(imageX, imageY);
            g.ScaleTransform(scaleX, scaleY);
            using (GraphicsPath path = new GraphicsPath()) {
                path.AddBezier(32f, 66f, 30f, 38f, 47f, 31f, 58f, 43f);
                path.AddBezier(58f, 43f, 80f, 27f, 93f, 48f, 91f, 66f);
                path.AddBezier(91f, 66f, 111f, 88f, 99f, 117f, 82f, 126f);
                path.AddBezier(82f, 126f, 55f, 141f, 25f, 119f, 22f, 91f);
                path.AddBezier(22f, 91f, 18f, 78f, 25f, 69f, 32f, 66f);
                path.CloseFigure();
                using (SolidBrush brush = new SolidBrush(color)) g.FillPath(brush, path);
                using (Pen pen = new Pen(Color.FromArgb(48, 61, 98), 3f)) g.DrawPath(pen, path);
            }
            using (SolidBrush eye = new SolidBrush(Color.FromArgb(38, 51, 75))) {
                int eyeHeight = petState == "success" ? 3 : 13;
                g.FillEllipse(eye, 43f, 83f, 8f, eyeHeight);
                g.FillEllipse(eye, 77f, 83f, 8f, eyeHeight);
            }
            using (SolidBrush blush = new SolidBrush(Color.FromArgb(255, 150, 174))) {
                g.FillEllipse(blush, 28f, 106f, 13f, 6f);
                g.FillEllipse(blush, 84f, 106f, 13f, 6f);
            }
            using (Pen pen = new Pen(Color.FromArgb(38, 51, 75), 2.5f)) {
                if (petState == "error") {
                    g.DrawArc(pen, 53f, 105f, 17f, 12f, 200f, 140f);
                } else {
                    g.DrawArc(pen, 53f, 106f, 17f, 12f, 20f, 140f);
                }
            }
        } finally {
            g.Restore(state);
        }
    }

    // ------------------------------------------------------------------
    // Image cache (LRU, cap 160)
    // ------------------------------------------------------------------
    private Bitmap GetCachedImage(string stateName, int frame) {
        string frameText = frame.ToString("D3");
        string key = stateName + "/" + frameText;
        Bitmap cached;
        if (imageCache.TryGetValue(key, out cached)) {
            TouchImage(key);
            return cached;
        }
        Bitmap loaded = null;
        try {
            string path = Path.Combine(Path.Combine(assetDirectory, stateName), frameText + ".png");
            if (File.Exists(path)) {
                using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) {
                    using (Image source = Image.FromStream(stream)) {
                        loaded = new Bitmap(source);
                    }
                }
            }
        } catch (Exception) {
            loaded = null;
        }
        if (loaded != null) {
            imageCache[key] = loaded;
            imageOrder.Add(key);
            while (imageOrder.Count > IMAGE_CACHE_CAP) {
                string oldestKey = imageOrder[0];
                imageOrder.RemoveAt(0);
                Bitmap oldest;
                if (imageCache.TryGetValue(oldestKey, out oldest)) {
                    imageCache.Remove(oldestKey);
                    try {
                        oldest.Dispose();
                    } catch (Exception) {
                    }
                }
            }
        }
        return loaded;
    }

    private void TouchImage(string key) {
        int index = imageOrder.IndexOf(key);
        if (index >= 0) {
            imageOrder.RemoveAt(index);
            imageOrder.Add(key);
        }
    }

    // ------------------------------------------------------------------
    // Drawing helpers
    // ------------------------------------------------------------------
    private static RectangleF InflateRect(RectangleF rect, float amount) {
        return new RectangleF(rect.X - amount, rect.Y - amount, rect.Width + amount * 2f, rect.Height + amount * 2f);
    }

    private static RectangleF ScaleRect(RectangleF rect, float scale) {
        float width = rect.Width * scale;
        float height = rect.Height * scale;
        return new RectangleF(rect.X + (rect.Width - width) / 2f, rect.Y + (rect.Height - height) / 2f, width, height);
    }

    private static GraphicsPath RoundedPath(RectangleF rect, float radius) {
        GraphicsPath path = new GraphicsPath();
        if (rect.Width <= 0.5f || rect.Height <= 0.5f) {
            path.AddRectangle(rect);
            return path;
        }
        float diameter = radius * 2f;
        float maxDiameter = Math.Min(rect.Width, rect.Height);
        if (diameter > maxDiameter) diameter = maxDiameter;
        if (diameter < 1f) diameter = 1f;
        path.AddArc(rect.X, rect.Y, diameter, diameter, 180f, 90f);
        path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270f, 90f);
        path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0f, 90f);
        path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90f, 90f);
        path.CloseFigure();
        return path;
    }

    private static void FillRoundedRect(Graphics g, RectangleF rect, float radius, Color color) {
        if (rect.Width <= 0f || rect.Height <= 0f) return;
        using (GraphicsPath path = RoundedPath(rect, radius)) {
            using (SolidBrush brush = new SolidBrush(color)) {
                g.FillPath(brush, path);
            }
        }
    }

    private static void FillRoundedGradient(Graphics g, RectangleF rect, float radius, Color startColor, Color endColor) {
        if (rect.Width <= 0f || rect.Height <= 0f) return;
        using (GraphicsPath path = RoundedPath(rect, radius)) {
            using (LinearGradientBrush brush = new LinearGradientBrush(new PointF(rect.Left, rect.Top), new PointF(rect.Right, rect.Bottom), startColor, endColor)) {
                g.FillPath(brush, path);
            }
        }
    }

    private static void StrokeRoundedRect(Graphics g, RectangleF rect, float radius, Color color, float width) {
        if (rect.Width <= 0f || rect.Height <= 0f || width <= 0f) return;
        using (GraphicsPath path = RoundedPath(rect, radius)) {
            using (Pen pen = new Pen(color, width)) {
                g.DrawPath(pen, path);
            }
        }
    }

    // ------------------------------------------------------------------
    // Task helpers
    // ------------------------------------------------------------------
    private static string TaskTitleOf(Dictionary<string, object> task) {
        object raw;
        if (task != null && task.TryGetValue("title", out raw) && raw != null) {
            string value = Convert.ToString(raw);
            if (!String.IsNullOrEmpty(value)) return value;
        }
        return "当前任务";
    }

    private int BubbleTaskWidth(Dictionary<string, object> task, int titlePad, int detailPad) {
        string taskTitle = TaskTitleOf(task);
        string taskStep = TaskStepOf(task);
        int titleWidth = Px(MeasureText(taskTitle, titleFont)) + titlePad;
        int stepWidth = Px(MeasureText(taskStep, detailFont)) + detailPad;
        return Math.Max(titleWidth, stepWidth);
    }

    private static string TaskStepOf(Dictionary<string, object> task) {
        string taskTitle = TaskTitleOf(task);
        object raw;
        string taskDetail = "";
        if (task != null && task.TryGetValue("detail", out raw) && raw != null) taskDetail = Convert.ToString(raw);
        if (!String.IsNullOrWhiteSpace(taskDetail) && taskDetail != taskTitle) return taskDetail;
        string taskLabel = "";
        if (task != null && task.TryGetValue("label", out raw) && raw != null) taskLabel = Convert.ToString(raw);
        return taskLabel;
    }

    private static string StatusOf(Dictionary<string, object> task) {
        object raw;
        if (task != null && task.TryGetValue("status", out raw) && raw != null) {
            string value = Convert.ToString(raw);
            if (value == "idle" || value == "running" || value == "waiting" || value == "success" || value == "error") return value;
        }
        if (task != null && task.TryGetValue("state", out raw) && raw != null) {
            string stateValue = Convert.ToString(raw);
            if (stateValue == "idle") return "idle";
            if (stateValue == "waiting") return "waiting";
            if (stateValue == "success") return "success";
            if (stateValue == "error") return "error";
            return "running";
        }
        return "idle";
    }

    private int SelectedTaskIndex() {
        if (String.IsNullOrEmpty(selectedTaskId)) return -1;
        for (int i = 0; i < tasks.Count; i++) {
            object raw;
            if (tasks[i].TryGetValue("sessionId", out raw) && raw != null && Convert.ToString(raw) == selectedTaskId) return i;
        }
        return -1;
    }

    private int ChipAt(Point point) {
        if (tasks.Count <= 1 || chipRects == null) return -1;
        float padding = 4f * dpiScale;
        for (int i = 0; i < chipRects.Length; i++) {
            RectangleF rect = chipRects[i];
            RectangleF hit = new RectangleF(rect.X - padding, rect.Y - padding, rect.Width + padding * 2f, rect.Height + padding * 2f);
            if (hit.Contains(point.X, point.Y)) return i;
        }
        return -1;
    }

    // ------------------------------------------------------------------
    // Mouse / hit testing / dragging
    // ------------------------------------------------------------------
    protected override void WndProc(ref Message m) {
        if (m.Msg == WM_NCHITTEST) {
            try {
                long raw = m.LParam.ToInt64();
                int screenX = (short)(raw & 0xFFFF);
                int screenY = (short)((raw >> 16) & 0xFFFF);
                Point client = PointToClient(new Point(screenX, screenY));
                if (premultiplied == null || client.X < 0 || client.Y < 0 || client.X >= bufferWidth || client.Y >= bufferHeight) {
                    m.Result = new IntPtr(HTTRANSPARENT);
                    return;
                }
                int alphaIndex = (client.Y * bufferWidth + client.X) * 4 + 3;
                if (alphaIndex < 0 || alphaIndex >= premultiplied.Length) {
                    m.Result = new IntPtr(HTTRANSPARENT);
                    return;
                }
                if (premultiplied[alphaIndex] < 8) {
                    m.Result = new IntPtr(HTTRANSPARENT);
                } else {
                    m.Result = new IntPtr(HTCLIENT);
                }
                return;
            } catch (Exception) {
                m.Result = new IntPtr(HTCLIENT);
                return;
            }
        }
        if (m.Msg == WM_DPICHANGED) {
            try {
                long word = m.WParam.ToInt64();
                int newDpi = (int)(word & 0xFFFF);
                if (newDpi >= 72 && newDpi <= 480) {
                    forcedDpiScale = newDpi / 96f;
                }
                UpdateLayout(false);
                RenderFrame();
            } catch (Exception) {
            }
            m.Result = IntPtr.Zero;
            return;
        }
        base.WndProc(ref m);
    }

    private void OnPetMouseDown(object sender, MouseEventArgs e) {
        if (e.Button != MouseButtons.Left) return;
        int index = ChipAt(e.Location);
        if (index >= 0) return;
        dragging = true;
        dragStartCursor = Cursor.Position;
        dragStartLocation = Location;
        Capture = true;
    }

    private void OnPetMouseMove(object sender, MouseEventArgs e) {
        int index = ChipAt(e.Location);
        if (index != hoverChip) {
            hoverChip = index;
            UpdateChipTooltip(index);
            RenderFrame();
            if (index >= 0 && index < tasks.Count && (Control.MouseButtons & MouseButtons.Left) == 0) {
                object rawId;
                string hoverId = tasks[index].TryGetValue("sessionId", out rawId) && rawId != null ? Convert.ToString(rawId) : "";
                if (!String.IsNullOrEmpty(hoverId) && hoverId != selectedTaskId) SendSelect(tasks[index]);
            }
        }
        SetHover(index >= 0);
        Cursor = index >= 0 ? Cursors.Hand : Cursors.SizeAll;
        if (dragging && dragStartCursor.HasValue && (Control.MouseButtons & MouseButtons.Left) == MouseButtons.Left) {
            Point now = Cursor.Position;
            Location = new Point(dragStartLocation.X + now.X - dragStartCursor.Value.X, dragStartLocation.Y + now.Y - dragStartCursor.Value.Y);
        }
    }

    private void OnPetMouseUp(object sender, MouseEventArgs e) {
        if (e.Button != MouseButtons.Left) return;
        bool wasDragging = dragging;
        dragging = false;
        dragStartCursor = null;
        Capture = false;
        if (wasDragging) SavePosition();
    }

    private void OnPetMouseLeave(object sender, EventArgs e) {
        if (hoverChip != -1) {
            hoverChip = -1;
            UpdateChipTooltip(-1);
            RenderFrame();
        }
        SetHover(false);
        Cursor = Cursors.Default;
        Capture = false;
        dragging = false;
        dragStartCursor = null;
    }

    private void SetHover(bool value) {
        if (hoveringTasks == value) return;
        hoveringTasks = value;
        Dictionary<string, object> payload = new Dictionary<string, object>();
        payload["type"] = "hover";
        payload["hovered"] = value;
        SendJson(payload);
        if (IsHandleCreated) {
            UpdateLayout(false);
            RenderFrame();
        }
    }

    private void SendSelect(Dictionary<string, object> task) {
        if (task == null) return;
        object raw;
        if (!task.TryGetValue("sessionId", out raw) || raw == null) return;
        string sessionId = Convert.ToString(raw);
        if (String.IsNullOrEmpty(sessionId)) return;
        Dictionary<string, object> payload = new Dictionary<string, object>();
        payload["type"] = "select";
        payload["sessionId"] = sessionId;
        SendJson(payload);
    }

    private void SendJson(Dictionary<string, object> payload) {
        try {
            Console.WriteLine(json.Serialize(payload));
            Console.Out.Flush();
        } catch (Exception) {
        }
    }

    private void UpdateChipTooltip(int index) {
        try {
            if (chipToolTip == null) return;
            if (index >= 0 && index < tasks.Count) {
                chipToolTip.SetToolTip(this, TaskTitleOf(tasks[index]) + " · " + StatusLabelOf(StatusOf(tasks[index])));
            } else {
                chipToolTip.SetToolTip(this, "");
            }
        } catch (Exception) {
        }
    }

    private static string StatusLabelOf(string chipStatus) {
        if (chipStatus == "running") return "运行中";
        if (chipStatus == "waiting") return "等待确认";
        if (chipStatus == "success") return "已完成";
        if (chipStatus == "error") return "失败";
        return "待机";
    }

    // ------------------------------------------------------------------
    // Position persistence
    // ------------------------------------------------------------------
    private string SettingsPath() {
        // %LOCALAPPDATA%\dsh-alk-pet\window.json
        string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "dsh-alk-pet");
        return Path.Combine(directory, "window.json");
    }

    private void LoadSavedPosition() {
        savedPosition = null;
        try {
            string path = SettingsPath();
            if (File.Exists(path)) {
                string content = File.ReadAllText(path);
                if (content.Length > 0 && content[0] == '\uFEFF') content = content.Substring(1);
                Dictionary<string, object> data = json.DeserializeObject(content) as Dictionary<string, object>;
                if (data != null) {
                    object rawX;
                    object rawY;
                    if (data.TryGetValue("x", out rawX) && data.TryGetValue("y", out rawY)) {
                        savedPosition = new Point(SafeInt(rawX, 0), SafeInt(rawY, 0));
                    }
                }
            }
        } catch (Exception) {
            savedPosition = null;
        }
        if (savedPosition.HasValue) {
            Location = savedPosition.Value;
        } else {
            try {
                Rectangle area = Screen.PrimaryScreen.WorkingArea;
                Location = new Point(area.Right - 184, area.Bottom - 160);
            } catch (Exception) {
                Location = new Point(0, 0);
            }
        }
    }

    private void SavePosition() {
        try {
            string path = SettingsPath();
            string directory = Path.GetDirectoryName(path);
            if (!String.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            Dictionary<string, object> data = new Dictionary<string, object>();
            data["x"] = Left;
            data["y"] = Top;
            File.WriteAllText(path, json.Serialize(data));
        } catch (Exception) {
        }
    }

    private void OnPetFormClosing(object sender, FormClosingEventArgs e) {
        SavePosition();
    }

    // ------------------------------------------------------------------
    // Cleanup
    // ------------------------------------------------------------------
    private void DisposeResources() {
        try {
            if (animationTimer != null) {
                animationTimer.Stop();
                animationTimer.Dispose();
                animationTimer = null;
            }
        } catch (Exception) {
        }
        DisposeBuffers();
        DisposeFonts();
        try {
            if (chipToolTip != null) {
                chipToolTip.Dispose();
                chipToolTip = null;
            }
        } catch (Exception) {
        }
        try {
            foreach (Bitmap bitmap in imageCache.Values) {
                try {
                    bitmap.Dispose();
                } catch (Exception) {
                }
            }
            imageCache.Clear();
            imageOrder.Clear();
        } catch (Exception) {
        }
    }
}
'@

try {
    Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Windows.Forms','System.Drawing','System.Web.Extensions'
    [PetForm]::SetupDpiAwareness()
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $petForm = New-Object PetForm -ArgumentList (Join-Path $PSScriptRoot '..\..\assets\animations')
    [System.Windows.Forms.Application]::Run($petForm)
} catch {
    [Console]::Error.WriteLine('[dsh-alk-pet] windows helper failed: ' + $_.Exception.ToString())
    exit 1
}
