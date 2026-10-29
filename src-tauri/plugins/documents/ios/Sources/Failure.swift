import Foundation

/// A failure reported to the page with one of the codes `documents.ts` knows.
enum Failure: Error {
  case exists(String)
  case missing(String)
  case forbidden(String)
  case invalidName
  case unavailable(String)
  case tooLarge
  case io(String)

  var code: String {
    switch self {
    case .exists: return "exists"
    case .missing: return "missing"
    case .forbidden: return "forbidden"
    case .invalidName: return "invalid-name"
    case .unavailable: return "unavailable"
    case .tooLarge: return "too-large"
    case .io: return "io"
    }
  }

  var message: String {
    switch self {
    case .exists(let message), .missing(let message), .forbidden(let message),
      .unavailable(let message), .io(let message):
      return message
    case .invalidName: return "The name is empty or contains “/” or “:”."
    case .tooLarge: return "The file is too large to open."
    }
  }

  static func from(_ error: Error) -> Failure {
    if let failure = error as? Failure { return failure }
    let error = error as NSError
    let message = error.localizedDescription
    if error.domain == NSCocoaErrorDomain {
      switch error.code {
      case NSFileNoSuchFileError, NSFileReadNoSuchFileError:
        return .missing(message)
      case NSFileReadNoPermissionError, NSFileWriteNoPermissionError,
        NSFileWriteVolumeReadOnlyError:
        return .forbidden(message)
      case NSFileWriteFileExistsError:
        return .exists(message)
      default:
        break
      }
    }
    if error.domain == NSPOSIXErrorDomain {
      switch Int32(error.code) {
      case ENOENT: return .missing(message)
      case EACCES, EPERM, EROFS: return .forbidden(message)
      case EEXIST: return .exists(message)
      default: break
      }
    }
    if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError,
      underlying.domain == NSPOSIXErrorDomain
    {
      return from(underlying)
    }
    return .io(message)
  }
}

/// A file or folder name the user typed: not empty, no path separators.
func validName(_ name: String) throws -> String {
  let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty || trimmed.contains("/") || trimmed.contains(":") {
    throw Failure.invalidName
  }
  return trimmed
}

/// The path as Rust's `canonicalize` gives it, so both sides name a file alike.
func canonicalPath(_ url: URL) -> String {
  if let resolved = realpath(url.path, nil) {
    defer { free(resolved) }
    return String(cString: resolved)
  }
  let parent = url.deletingLastPathComponent()
  if let resolved = realpath(parent.path, nil) {
    defer { free(resolved) }
    return (String(cString: resolved) as NSString).appendingPathComponent(url.lastPathComponent)
  }
  return url.standardizedFileURL.path
}
