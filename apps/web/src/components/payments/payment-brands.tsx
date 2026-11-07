import Image from "next/image";

const brands = {
  visa: { name: "Visa", file: "visa.svg", width: 1924, height: 618 },
  mastercard: { name: "Mastercard", file: "mastercard.png", width: 1200, height: 932 },
  maestro: { name: "Maestro", file: "maestro.svg", width: 117, height: 90 },
  amex: { name: "American Express", file: "american-express.svg", width: 501, height: 501 },
  discover: { name: "Discover", file: "discover.svg", width: 1458, height: 933 },
  diners: { name: "Diners Club", file: "diners-club.svg", width: 1477, height: 412 },
  jcb: { name: "JCB", file: "jcb.gif", width: 134, height: 104 },
  apple_pay: { name: "Apple Pay", file: "apple-pay.svg", width: 166, height: 106 },
  google_pay: { name: "Google Pay", file: "google-pay.svg", width: 754, height: 401 },
} as const;

type PaymentBrand = keyof typeof brands;

export function PaymentBrandIcon({
  brand,
  decorative = false,
}: {
  brand: PaymentBrand;
  decorative?: boolean;
}) {
  const asset = brands[brand];
  return (
    <span className="bpt-payment-brand" data-brand={brand}>
      <Image
        src={`/payment-brands/${asset.file}`}
        alt={decorative ? "" : asset.name}
        width={asset.width}
        height={asset.height}
        unoptimized
      />
    </span>
  );
}

export function PaymentCardBrands() {
  return (
    <div className="bpt-payment-card-brands" role="group" aria-label="Card types">
      {(["visa", "mastercard", "maestro", "amex", "discover", "diners", "jcb"] as const).map(
        (brand) => <PaymentBrandIcon key={brand} brand={brand} />,
      )}
    </div>
  );
}
