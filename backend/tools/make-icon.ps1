Add-Type -AssemblyName System.Drawing

$outPath = 'D:\server\plc-full-project\backend\assets\eap-monitor.ico'
$sizes   = @(16, 24, 32, 48, 64, 128, 256)

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

function New-IconBitmap([int]$s) {
    # pulse / heartbeat polyline, as fractions of the icon size
    $pulse = @(
        @(0.15, 0.54), @(0.31, 0.54), @(0.39, 0.32),
        @(0.51, 0.74), @(0.61, 0.46), @(0.69, 0.54), @(0.85, 0.54)
    )

    $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)

    $inset  = [single]($s * 0.045)
    $side   = [single]($s - $inset * 2)
    $radius = [single]($s * 0.215)
    $body   = New-RoundedPath $inset $inset $side $side $radius

    # green gradient body
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point(0, $s)),
        [System.Drawing.Color]::FromArgb(255, 86, 211, 100),
        [System.Drawing.Color]::FromArgb(255, 26, 127, 55))
    $g.FillPath($brush, $body)

    # dark rim so it stays defined on a light desktop
    $penW = [single]([Math]::Max(1.0, $s * 0.035))
    $rim  = New-Object System.Drawing.Pen(
        [System.Drawing.Color]::FromArgb(255, 13, 17, 23), $penW)
    $g.DrawPath($rim, $body)

    # heartbeat line
    $pts = @()
    foreach ($p in $pulse) {
        $pts += New-Object System.Drawing.PointF([single]($p[0] * $s), [single]($p[1] * $s))
    }
    $linePen = New-Object System.Drawing.Pen(
        [System.Drawing.Color]::FromArgb(255, 13, 17, 23),
        [single]([Math]::Max(1.4, $s * 0.085)))
    $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $linePen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $linePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawLines($linePen, [System.Drawing.PointF[]]$pts)

    $linePen.Dispose(); $rim.Dispose(); $brush.Dispose(); $body.Dispose(); $g.Dispose()
    return $bmp
}

# Convert a bitmap to a classic DIB icon image: BITMAPINFOHEADER + bottom-up BGRA + AND mask.
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

    # XOR bitmap, bottom-up
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

$images = @()
foreach ($s in $sizes) {
    $bmp = New-IconBitmap $s
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

$fs = [System.IO.File]::Create($outPath)
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

Write-Output ("Wrote {0} ({1} bytes, sizes: {2})" -f $outPath, (Get-Item $outPath).Length, ($sizes -join ', '))
