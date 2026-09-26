import { JoinForm } from "./join-form";

export const metadata = { title: "Join the 21Moons community" };

export default function JoinPage() {
  return <main className="mx-auto max-w-xl px-5 py-10 sm:py-16">
    <div className="mb-8"><div className="text-xs font-bold tracking-[.3em] text-violet">21MOONS</div>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Stay connected after the hackathon.</h1>
      <p className="mt-3 text-mist">Leave your details so the 21Moons team can follow up about your project and future opportunities. Takes one minute.</p>
    </div>
    <JoinForm />
  </main>;
}
