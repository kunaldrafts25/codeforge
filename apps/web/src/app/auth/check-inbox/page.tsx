export default function CheckInboxPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold mb-2">Check your inbox</h1>
        <p className="text-muted-foreground">
          We sent a verification link to your email. Click it to activate your account, then log in.
        </p>
      </div>
    </div>
  )
}
