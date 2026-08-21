# Renders the Sentra icons: the "sentry ring" mark, on two different fields.
#
# Outputs
#   backend/assets/eap-monitor.ico        desktop shortcut / window icon
#                                         -> the horizontal ink badge
#   frontend/brand/sentra-icon-512.png    generic PNG icon
#   frontend/brand/apple-touch-icon.png   180px, for "add to home screen"
#   frontend/brand/favicon-32.png         .ico fallback for old browsers
#                                         -> the square accent squircle
#
# Two shapes on purpose. The browser and iOS both crop/mask to a square, so the
# web icons use the squircle from frontend/brand/sentra-icon-accent-512.svg. The
# desktop shortcut was asked for as the horizontal badge, drawn from
# frontend/brand/sentra-badge-horizontal.svg - keep each SVG in step with the
# code below if the artwork changes.
#
# A .ico frame is always square, so the badge is letterboxed: it spans the full
# width and is centred vertically, which leaves the mark at half the height it
# would get on a squircle. That is why the small frames enlarge the mark within
# the badge and drop the dashed inner ring, which the brand sheet allows below
# 40px and which would otherwise render as mush.
Add-Type -AssemblyName System.Drawing

$root      = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$icoPath   = Join-Path $root 'backend\assets\eap-monitor.ico'
$brandDir  = Join-Path $root 'frontend\brand'
$icoSizes  = @(16, 24, 32, 48, 64, 128, 256)

$Accent = [System.Drawing.Color]::FromArgb(255, 0x3B, 0x6F, 0xE0)
$Ink    = [System.Drawing.Color]::FromArgb(255, 0x0B, 0x0C, 0x0E)
$White  = [System.Drawing.Color]::White

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x,           $y,           $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y,           $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d,   0, 90)
    $p.AddArc($x,           $y + $h - $d, $d, $d,  90, 90)
    $p.CloseFigure()
    return $p
}

# Draws the mark on its native 48x48 grid, scaled by $k and offset by $ox/$oy.
function Draw-Mark($g, [single]$ox, [single]$oy, [single]$k, [bool]$withDashes, $dotColor) {
    $stroke = [single](3.2 * $k)
    $cx = $ox + 24 * $k
    $cy = $oy + 24 * $k

    $pen = New-Object System.Drawing.Pen($White, $stroke)
    $r = [single](20 * $k)
    $g.DrawEllipse($pen, $cx - $r, $cy - $r, $r * 2, $r * 2)

    if ($withDashes) {
        $dash = New-Object System.Drawing.Pen($White, $stroke)
        # SVG stroke-dasharray "12 8" is in user units; GDI+ wants pen widths.
        $dash.DashPattern = [single[]]@([single](12 / 3.2), [single](8 / 3.2))
        $dash.DashCap     = [System.Drawing.Drawing2D.DashCap]::Round
        $ri = [single](11 * $k)
        $g.DrawEllipse($dash, $cx - $ri, $cy - $ri, $ri * 2, $ri * 2)
        $dash.Dispose()
    }

    # the sentry dot, at 12 o'clock on the outer ring
    $brush = New-Object System.Drawing.SolidBrush($dotColor)
    $rd = [single](4.6 * $k)
    $dx = $ox + 24 * $k
    $dy = $oy + 4 * $k
    $g.FillEllipse($brush, $dx - $rd, $dy - $rd, $rd * 2, $rd * 2)

    $brush.Dispose(); $pen.Dispose()
}

# Square accent squircle - the web icons.
function New-SquareBitmap([int]$s) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    # accent squircle: 114/512 corner radius, same as the SVG
    $radius = [single]($s * 114 / 512)
    $tile   = New-RoundedPath 0 0 ([single]$s) ([single]$s) $radius
    $fill   = New-Object System.Drawing.SolidBrush($Accent)
    $g.FillPath($fill, $tile)

    # the SVG insets the 48-unit mark by 128/512 and scales it to 256/512
    $k  = [single]($s * 256 / 512 / 48)
    $in = [single]($s * 128 / 512)
    Draw-Mark $g $in $in $k ($s -ge 40) $White

    $fill.Dispose(); $tile.Dispose(); $g.Dispose()
    return $bmp
}

# Horizontal ink badge, letterboxed into a square frame - the desktop icon.
function New-BadgeBitmap([int]$s) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $h   = [single]($s / 2.0)      # 2:1, full width
    $top = [single](($s - $h) / 2) # centred in the square frame
    $tile = New-RoundedPath 0 $top ([single]$s) $h ([single]($h * 0.30))
    $fill = New-Object System.Drawing.SolidBrush($Ink)
    $g.FillPath($fill, $tile)

    # below ~40px of badge height the dashes turn to mush, so drop them and let
    # the mark grow into the space they were taking
    $dashes = ($h -ge 40)
    if ($dashes) { $frac = 0.75 } else { $frac = 0.86 }
    $k = [single]($h * $frac / 48)
    Draw-Mark $g ([single]($s / 2.0 - 24 * $k)) ([single]($top + $h / 2.0 - 24 * $k)) $k $dashes $Accent

    $fill.Dispose(); $tile.Dispose(); $g.Dispose()
    return $bmp
}

# Classic DIB icon frame: BITMAPINFOHEADER + bottom-up BGRA + AND mask.
function ConvertTo-IconDib([System.Drawing.Bitmap]$bmp) {
    $s    = $bmp.Width
    $rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
    $ld   = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                          [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $src  = New-Object byte[] ($ld.Stride * $s)
    [System.Runtime.InteropServices.Marshal]::Copy($ld.Scan0, $src, 0, $src.Length)
    $bmp.UnlockBits($ld)

    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)

    $bw.Write([UInt32]40)        # biSize
    $bw.Write([Int32]$s)         # biWidth
    $bw.Write([Int32]($s * 2))   # biHeight = XOR + AND
    $bw.Write([UInt16]1)         # biPlanes
    $bw.Write([UInt16]32)        # biBitCount
    $bw.Write([UInt32]0)         # biCompression = BI_RGB
    $bw.Write([UInt32]($s * $s * 4))
    $bw.Write([Int32]0); $bw.Write([Int32]0)
    $bw.Write([UInt32]0); $bw.Write([UInt32]0)

    for ($y = $s - 1; $y -ge 0; $y--) {
        $bw.Write($src, $y * $ld.Stride, $s * 4)
    }

    # AND mask, all zero: the 32-bit alpha channel carries transparency
    $maskRow = [int]([Math]::Floor(($s + 31) / 32) * 4)
    $bw.Write((New-Object byte[] ($maskRow * $s)))

    $bw.Flush()
    $bytes = $ms.ToArray()
    $bw.Close(); $ms.Dispose()
    return ,$bytes
}

function Save-Png([int]$s, [string]$path) {
    $bmp = New-SquareBitmap $s
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ("Wrote {0} ({1} bytes)" -f $path, (Get-Item $path).Length)
}

# ── .ico ──────────────────────────────────────────────
$images = @()
foreach ($s in $icoSizes) {
    $bmp = New-BadgeBitmap $s
    if ($s -ge 256) {
        # 256px is PNG-compressed by convention, keeping the file small
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $images += ,@($s, $ms.ToArray())
        $ms.Dispose()
    } else {
        $images += ,@($s, (ConvertTo-IconDib $bmp))
    }
    $bmp.Dispose()
}

$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)

$bw.Write([UInt16]0)                # reserved
$bw.Write([UInt16]1)                # type: icon
$bw.Write([UInt16]$images.Count)

$offset = 6 + (16 * $images.Count)
foreach ($img in $images) {
    $s = $img[0]; $data = $img[1]
    if ($s -ge 256) { $dim = 0 } else { $dim = $s }
    $bw.Write([Byte]$dim)           # width  (0 means 256)
    $bw.Write([Byte]$dim)           # height
    $bw.Write([Byte]0)              # palette colours
    $bw.Write([Byte]0)              # reserved
    $bw.Write([UInt16]1)            # colour planes
    $bw.Write([UInt16]32)           # bits per pixel
    $bw.Write([UInt32]$data.Length)
    $bw.Write([UInt32]$offset)
    $offset += $data.Length
}
foreach ($img in $images) { $bw.Write($img[1]) }

$bw.Flush(); $bw.Close(); $fs.Close()
Write-Output ("Wrote {0} ({1} bytes, sizes: {2})" -f $icoPath, (Get-Item $icoPath).Length, ($icoSizes -join ', '))

# ── PNGs for the web page ─────────────────────────────
Save-Png 512 (Join-Path $brandDir 'sentra-icon-512.png')
Save-Png 180 (Join-Path $brandDir 'apple-touch-icon.png')
Save-Png 32  (Join-Path $brandDir 'favicon-32.png')
