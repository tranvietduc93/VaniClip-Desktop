// ============================================================
//  QUYEN SU DUNG (Entitlements)
//  Hien tai: MO HET - free toan bo, khong paywall.
//
//  >>> SAU NAY MUON BAN HANG: chi sua DUY NHAT ham nay <<<
//  Vi du: doi thanh goi API license cua vaniclip.com:
//     const res = await fetch('https://vaniclip.com/api/license', {...})
//     return await res.json()
//  Phan con lai cua app khong can dong toi.
// ============================================================
export function getEntitlements() {
  return {
    plan: 'free-all',
    watermark: false,      // khong dong watermark
    aiCaption: true,       // phu de tu dong
    removeBg: true,        // xoa nen
    maxExport: '4k',       // gioi han do phan giai xuat
    unlimited: true        // khong gioi han so project
  }
}
