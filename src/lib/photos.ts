/**
 * Real photographs from India, used under their free licences with the credit
 * each licence requires. Files are served by Wikimedia's image servers; if one
 * cannot load, the UI shows a plain panel instead (see components/ui/photo.tsx).
 * Replace any entry with the plant's own photo by pointing `src` at /photos/….
 */
export interface PhotoCredit {
  src: string;
  alt: string;
  place: string;
  author: string;
  licence: string;
  licenceUrl: string;
  page: string;
  width: number;
  height: number;
}

const thumb = (hash: string, name: string, w = 1280) => `https://upload.wikimedia.org/wikipedia/commons/thumb/${hash[0]}/${hash}/${name}/${w}px-${name}`;
const BY_SA_4 = { licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/" };
const BY_SA_3 = { licence: "CC BY-SA 3.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/3.0/" };

export const PHOTOS = {
  casting: {
    src: thumb("dd", "Making_the_Outer_Mold_for_Bharai_Kaam_Metal_Casting_in_Tigariya%2C_Betul%2C_Madhya_Pradesh_03.jpg"),
    alt: "An artisan pressing the clay outer mould over a wax pattern for lost-wax metal casting",
    place: "Tigariya, Betul, Madhya Pradesh",
    author: "Shoot stufz",
    ...BY_SA_4,
    page: "https://commons.wikimedia.org/wiki/File:Making_the_Outer_Mold_for_Bharai_Kaam_Metal_Casting_in_Tigariya,_Betul,_Madhya_Pradesh_03.jpg",
    width: 4096,
    height: 3072,
  },
  moulds: {
    src: thumb("37", "Women_Making_Wax_Molds_for_Bharai_Kaam_in_Tigariya%2C_Betul%2C_Madhya_Pradesh_-01.jpg"),
    alt: "Women at work making wax moulds for metal casting in a craft village",
    place: "Tigariya, Betul, Madhya Pradesh",
    author: "Shoot stufz",
    ...BY_SA_4,
    page: "https://commons.wikimedia.org/wiki/File:Women_Making_Wax_Molds_for_Bharai_Kaam_in_Tigariya,_Betul,_Madhya_Pradesh_-01.jpg",
    width: 6944,
    height: 9248,
  },
  gridTamilNadu: {
    src: thumb("11", "Transmission_Tower_-_Erode_District_-_Tamilnadu_%2C_India.jpg"),
    alt: "A high-voltage transmission tower standing in farm fields",
    place: "Erode district, Tamil Nadu",
    author: "Mersaleashwaran",
    ...BY_SA_4,
    page: "https://commons.wikimedia.org/wiki/File:Transmission_Tower_-_Erode_District_-_Tamilnadu_,_India.jpg",
    width: 4160,
    height: 3120,
  },
  gridBengal: {
    src: thumb("db", "WBSETCL_tower.jpg"),
    alt: "A West Bengal State Electricity Transmission Company tower",
    place: "Kalyani, Nadia, West Bengal",
    author: "রাজশ্রী রায় (Rajashree Roy)",
    ...BY_SA_4,
    page: "https://commons.wikimedia.org/wiki/File:WBSETCL_tower.jpg",
    width: 3264,
    height: 1468,
  },
  gridNoida: {
    src: thumb("69", "Transmission_Tower%2C_Kalindi_Kunj_-_panoramio.jpg"),
    alt: "A transmission tower beside the road at Kalindi Kunj",
    place: "Kalindi Kunj, Noida, Uttar Pradesh",
    author: "Ali Rizvi",
    ...BY_SA_3,
    page: "https://commons.wikimedia.org/wiki/File:Transmission_Tower,_Kalindi_Kunj_-_panoramio.jpg",
    width: 2592,
    height: 1944,
  },
} satisfies Record<string, PhotoCredit>;

export type PhotoKey = keyof typeof PHOTOS;
